using System.Text.Json;
using Microsoft.Build.Locator;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.MSBuild;

if (args.Length != 2) throw new ArgumentException("Expected solution/project path and output JSON path.");
MSBuildLocator.RegisterDefaults();
await Analyze(args[0], args[1]);

static async Task Analyze(string input, string output)
{
    using var workspace = MSBuildWorkspace.Create();
    var loadDiagnostics = new System.Collections.Concurrent.ConcurrentQueue<string>();
    workspace.RegisterWorkspaceFailedHandler(e => loadDiagnostics.Enqueue(e.Diagnostic.Message));
    Solution solution;
    if (Path.GetExtension(input).Equals(".csproj", StringComparison.OrdinalIgnoreCase))
        solution = (await workspace.OpenProjectAsync(input)).Solution;
    else solution = await workspace.OpenSolutionAsync(input);
    var nodes = new Dictionary<string, GraphNode>();
    var edges = new Dictionary<string, GraphEdge>();
    var files = solution.Projects.SelectMany(p => p.Documents.Select(d => (d.FilePath, Project: p)))
        .Where(d => d.FilePath != null).GroupBy(d => d.FilePath!).ToDictionary(g => g.Key, g => g.First().Project);
    var diagnostics = new List<object>();
    string ProjectId(Project p) => "project:" + p.FilePath;
    void Edge(string source, string target, string kind)
    {
        if (source == target && kind != "calls (resolved)") return;
        var id = source + "|" + kind + "|" + target;
        if (edges.TryGetValue(id, out var prior)) prior.Count++;
        else edges[id] = new GraphEdge(id, source, target, kind);
    }
    string? Symbol(ISymbol? value)
    {
        if (value == null) return null;
        var symbol = value.OriginalDefinition;
        if (symbol is not INamedTypeSymbol && symbol is not IMethodSymbol) return null;
        var location = symbol.Locations.FirstOrDefault(l => l.IsInSource)
            ?? symbol.ContainingType?.Locations.FirstOrDefault(l => l.IsInSource);
        var file = location?.SourceTree?.FilePath;
        if (file == null || !files.TryGetValue(file, out var project)) return null;
        var full = symbol.ToDisplayString(SymbolDisplayFormat.CSharpErrorMessageFormat);
        var kind = symbol is IMethodSymbol ? "method" : ((INamedTypeSymbol)symbol).TypeKind.ToString().ToLowerInvariant();
        var id = "resolved:" + kind + ":" + full + "@" + file;
        if (!nodes.ContainsKey(id))
        {
            var line = location!.GetLineSpan().StartLinePosition.Line + 1;
            var label = symbol is IMethodSymbol method ? method.ContainingType.Name + "." + method.Name : symbol.Name;
            nodes[id] = new GraphNode(id, label, kind, full, file, line);
            Edge(ProjectId(project), id, "contains");
        }
        return id;
    }
    ISymbol? Owner(SemanticModel model, int position)
    {
        var symbol = model.GetEnclosingSymbol(position);
        while (symbol != null && symbol is not IMethodSymbol && symbol is not INamedTypeSymbol) symbol = symbol.ContainingSymbol;
        return symbol;
    }
    foreach (var project in solution.Projects.Where(p => p.Language == LanguageNames.CSharp))
    {
        nodes[ProjectId(project)] = new GraphNode(ProjectId(project), project.Name, "project", project.FilePath ?? "", project.FilePath, 1);
        foreach (var reference in project.ProjectReferences)
        {
            var target = solution.GetProject(reference.ProjectId);
            if (target != null) Edge(ProjectId(project), ProjectId(target), "ProjectReference (evaluated)");
        }
        var compilation = await project.GetCompilationAsync();
        if (compilation == null) continue;
        diagnostics.AddRange(compilation.GetDiagnostics().Where(d => d.Severity == DiagnosticSeverity.Error).Take(100)
            .Select(d => (object)new { project = project.Name, code = d.Id, message = d.GetMessage(), file = d.Location.SourceTree?.FilePath, line = d.Location.IsInSource ? d.Location.GetLineSpan().StartLinePosition.Line + 1 : 0 }));
        foreach (var tree in compilation.SyntaxTrees)
        {
            var model = compilation.GetSemanticModel(tree);
            var syntax = await tree.GetRootAsync();
            foreach (var declaration in syntax.DescendantNodes().Where(n => n is BaseTypeDeclarationSyntax || n is DelegateDeclarationSyntax || n is BaseMethodDeclarationSyntax || n is AccessorDeclarationSyntax || n is LocalFunctionStatementSyntax))
            {
                var symbol = model.GetDeclaredSymbol(declaration);
                var source = Symbol(symbol);
                if (source == null || symbol is not INamedTypeSymbol type) continue;
                foreach (var parent in type.AllInterfaces.Concat(type.BaseType == null ? [] : new[] { type.BaseType }))
                {
                    var target = Symbol(parent);
                    if (target != null) Edge(source, target, parent.TypeKind == TypeKind.Interface ? "implements (resolved)" : "inherits (resolved)");
                }
            }
            foreach (var call in syntax.DescendantNodes().Where(n => n is InvocationExpressionSyntax || n is ObjectCreationExpressionSyntax || n is ImplicitObjectCreationExpressionSyntax))
            {
                var caller = Symbol(Owner(model, call.SpanStart));
                var target = Symbol(model.GetSymbolInfo(call).Symbol);
                if (caller != null && target != null) Edge(caller, target, "calls (resolved)");
            }
            foreach (var reference in syntax.DescendantNodes().OfType<TypeSyntax>())
            {
                var type = model.GetTypeInfo(reference).Type as INamedTypeSymbol;
                var owner = Owner(model, reference.SpanStart);
                var caller = Symbol(owner is IMethodSymbol method ? method.ContainingType : owner);
                var target = Symbol(type);
                if (caller != null && target != null) Edge(caller, target, "uses type (resolved)");
            }
        }
    }
    await File.WriteAllTextAsync(output, JsonSerializer.Serialize(new { nodes = nodes.Values, edges = edges.Values, diagnostics, loadDiagnostics, engine = "Roslyn", scope = "Active project configuration; source symbols only. Metadata and dynamic/reflection calls are not expanded." }, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
}
record GraphNode(string Id, string Label, string Kind, string Detail, string? File, int Line);
class GraphEdge(string id, string source, string target, string kind)
{
    public string Id { get; } = id;
    public string Source { get; } = source;
    public string Target { get; } = target;
    public string Kind { get; } = kind;
    public int Count { get; set; } = 1;
}
