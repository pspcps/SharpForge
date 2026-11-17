import { SolutionFile, TestItem, DiagnosticItem } from '../types/minirider';

export const SAMPLE_SOLUTIONS: SolutionFile[] = [
  {
    name: 'WeatherTracker.sln',
    path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.sln',
    format: 'sln',
    projects: [
      {
        id: 'proj-api',
        name: 'WeatherTracker.Api',
        path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Api/WeatherTracker.Api.csproj',
        targetFramework: 'net8.0',
        projectType: 'webapi',
        dependencies: {
          frameworks: ['Microsoft.AspNetCore.App', 'Microsoft.NETCore.App'],
          packages: [
            { id: 'Swashbuckle.AspNetCore', version: '6.5.0', resolvedVersion: '6.5.0', isDirect: true },
            { id: 'Serilog.AspNetCore', version: '8.0.0', resolvedVersion: '8.0.0', isDirect: true },
            { id: 'Microsoft.Extensions.Logging', version: '8.0.0', resolvedVersion: '8.0.0', isDirect: false }
          ],
          projectReferences: ['WeatherTracker.Core']
        },
        launchSettings: {
          profiles: {
            'WeatherTracker.Api': {
              commandName: 'Project',
              dotnetRunMessages: true,
              launchBrowser: true,
              applicationUrl: 'http://localhost:5124',
              environmentVariables: {
                ASPNETCORE_ENVIRONMENT: 'Development'
              }
            }
          }
        },
        files: [
          {
            id: 'f-program',
            name: 'Program.cs',
            path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Api/Program.cs',
            relativePath: 'Program.cs',
            extension: '.cs',
            isDirectory: false,
            content: `using WeatherTracker.Core.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddScoped<IUserService, UserService>();
builder.Services.AddSingleton<IWeatherService, WeatherService>();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

app.Run();
`
          },
          {
            id: 'folder-controllers',
            name: 'Controllers',
            path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Api/Controllers',
            relativePath: 'Controllers',
            extension: '',
            isDirectory: true,
            children: [
              {
                id: 'f-users-ctrl',
                name: 'UsersController.cs',
                path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Api/Controllers/UsersController.cs',
                relativePath: 'Controllers/UsersController.cs',
                extension: '.cs',
                isDirectory: false,
                content: `using Microsoft.AspNetCore.Mvc;
using WeatherTracker.Core.Models;
using WeatherTracker.Core.Services;

namespace WeatherTracker.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    private readonly IUserService _service;
    private readonly ILogger<UsersController> _logger;

    public UsersController(IUserService service, ILogger<UsersController> logger)
    {
        _service = service;
        _logger = logger;
    }

    [HttpGet("{id:int}")]
    public IActionResult Get(int id)
    {
        _logger.LogInformation("Retrieving user profile with ID: {UserId}", id);
        var user = _service.GetUserById(id);
        if (user == null)
        {
            return NotFound(new { error = $"User with ID {id} not found." });
        }
        return Ok(user);
    }

    [HttpPost]
    public IActionResult Create([FromBody] CreateUserRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Email))
        {
            return BadRequest("Email address is required.");
        }

        var created = _service.CreateUser(request.Name, request.Email);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }
}
`
              },
              {
                id: 'f-weather-ctrl',
                name: 'WeatherForecastController.cs',
                path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Api/Controllers/WeatherForecastController.cs',
                relativePath: 'Controllers/WeatherForecastController.cs',
                extension: '.cs',
                isDirectory: false,
                content: `using Microsoft.AspNetCore.Mvc;
using WeatherTracker.Core.Models;
using WeatherTracker.Core.Services;

namespace WeatherTracker.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class WeatherForecastController : ControllerBase
{
    private readonly IWeatherService _weatherService;

    public WeatherForecastController(IWeatherService weatherService)
    {
        _weatherService = weatherService;
    }

    [HttpGet(Name = "GetWeatherForecast")]
    public IEnumerable<WeatherForecast> Get()
    {
        return _weatherService.GetForecasts();
    }
}
`
              }
            ]
          },
          {
            id: 'f-appsettings',
            name: 'appsettings.json',
            path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Api/appsettings.json',
            relativePath: 'appsettings.json',
            extension: '.json',
            isDirectory: false,
            content: `{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*"
}
`
          },
          {
            id: 'f-appsettings-dev',
            name: 'appsettings.Development.json',
            path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Api/appsettings.Development.json',
            relativePath: 'appsettings.Development.json',
            extension: '.json',
            isDirectory: false,
            content: `{
  "Logging": {
    "LogLevel": {
      "Default": "Debug",
      "Microsoft.AspNetCore": "Information"
    }
  },
  "ConnectionStrings": {
    "DefaultConnection": "Server=localhost;Database=WeatherTrackerDev;User Id=sa;Password=Secret123!;"
  },
  "JwtSettings": {
    "Secret": "SuperSecretKeyForCairn IDEDevEnvironment2026!",
    "Issuer": "WeatherTrackerApi",
    "Audience": "WeatherTrackerClients"
  },
  "Features": {
    "EnableDetailedTelemetry": "true",
    "UseRedisCache": "false"
  }
}
`
          },
          {
            id: 'folder-props',
            name: 'Properties',
            path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Api/Properties',
            relativePath: 'Properties',
            extension: '',
            isDirectory: true,
            children: [
              {
                id: 'f-launch',
                name: 'launchSettings.json',
                path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Api/Properties/launchSettings.json',
                relativePath: 'Properties/launchSettings.json',
                extension: '.json',
                isDirectory: false,
                content: `{
  "$schema": "https://json.schemastore.org/launchsettings.json",
  "profiles": {
    "WeatherTracker.Api": {
      "commandName": "Project",
      "dotnetRunMessages": true,
      "launchBrowser": true,
      "applicationUrl": "http://localhost:5124",
      "environmentVariables": {
        "ASPNETCORE_ENVIRONMENT": "Development"
      }
    }
  }
}
`
              }
            ]
          },
          {
            id: 'f-api-csproj',
            name: 'WeatherTracker.Api.csproj',
            path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Api/WeatherTracker.Api.csproj',
            relativePath: 'WeatherTracker.Api.csproj',
            extension: '.csproj',
            isDirectory: false,
            content: `<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Swashbuckle.AspNetCore" Version="6.5.0" />
    <PackageReference Include="Serilog.AspNetCore" Version="8.0.0" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\\WeatherTracker.Core\\WeatherTracker.Core.csproj" />
  </ItemGroup>

</Project>
`
          }
        ]
      },
      {
        id: 'proj-core',
        name: 'WeatherTracker.Core',
        path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Core/WeatherTracker.Core.csproj',
        targetFramework: 'net8.0',
        projectType: 'classlib',
        dependencies: {
          frameworks: ['Microsoft.NETCore.App'],
          packages: [],
          projectReferences: []
        },
        files: [
          {
            id: 'folder-models',
            name: 'Models',
            path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Core/Models',
            relativePath: 'Models',
            extension: '',
            isDirectory: true,
            children: [
              {
                id: 'f-user-model',
                name: 'User.cs',
                path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Core/Models/User.cs',
                relativePath: 'Models/User.cs',
                extension: '.cs',
                isDirectory: false,
                content: `namespace WeatherTracker.Core.Models;

public class User
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}

public record CreateUserRequest(string Name, string Email);
`
              },
              {
                id: 'f-weather-model',
                name: 'WeatherForecast.cs',
                path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Core/Models/WeatherForecast.cs',
                relativePath: 'Models/WeatherForecast.cs',
                extension: '.cs',
                isDirectory: false,
                content: `namespace WeatherTracker.Core.Models;

public record WeatherForecast(DateOnly Date, int TemperatureC, string? Summary)
{
    public int TemperatureF => 32 + (int)(TemperatureC / 0.5556);
}
`
              }
            ]
          },
          {
            id: 'folder-services',
            name: 'Services',
            path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Core/Services',
            relativePath: 'Services',
            extension: '',
            isDirectory: true,
            children: [
              {
                id: 'f-iuser-service',
                name: 'IUserService.cs',
                path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Core/Services/IUserService.cs',
                relativePath: 'Services/IUserService.cs',
                extension: '.cs',
                isDirectory: false,
                content: `using WeatherTracker.Core.Models;

namespace WeatherTracker.Core.Services;

public interface IUserService
{
    User? GetUserById(int id);
    User CreateUser(string name, string email);
    IEnumerable<User> GetAll();
}
`
              },
              {
                id: 'f-user-service',
                name: 'UserService.cs',
                path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Core/Services/UserService.cs',
                relativePath: 'Services/UserService.cs',
                extension: '.cs',
                isDirectory: false,
                content: `using WeatherTracker.Core.Models;

namespace WeatherTracker.Core.Services;

public class UserService : IUserService
{
    private static readonly List<User> _users = new()
    {
        new User { Id = 1, Name = "Ada Lovelace", Email = "ada@computing.org" },
        new User { Id = 2, Name = "Alan Turing", Email = "alan@enigma.ac.uk" },
        new User { Id = 42, Name = "Grace Hopper", Email = "grace@usnavy.mil" }
    };

    public User? GetUserById(int id)
    {
        // Step into inspection target
        return _users.FirstOrDefault(u => u.Id == id);
    }

    public User CreateUser(string name, string email)
    {
        var nextId = _users.Count > 0 ? _users.Max(u => u.Id) + 1 : 1;
        var newUser = new User
        {
            Id = nextId,
            Name = name,
            Email = email,
            CreatedAtUtc = DateTime.UtcNow
        };
        _users.Add(newUser);
        return newUser;
    }

    public IEnumerable<User> GetAll() => _users.AsReadOnly();
}
`
              },
              {
                id: 'f-weather-service',
                name: 'WeatherService.cs',
                path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Core/Services/WeatherService.cs',
                relativePath: 'Services/WeatherService.cs',
                extension: '.cs',
                isDirectory: false,
                content: `using WeatherTracker.Core.Models;

namespace WeatherTracker.Core.Services;

public interface IWeatherService
{
    IEnumerable<WeatherForecast> GetForecasts();
}

public class WeatherService : IWeatherService
{
    private static readonly string[] Summaries = new[]
    {
        "Freezing", "Bracing", "Chilly", "Cool", "Mild", "Warm", "Balmy", "Hot", "Sweltering", "Scorching"
    };

    public IEnumerable<WeatherForecast> GetForecasts()
    {
        return Enumerable.Range(1, 5).Select(index =>
            new WeatherForecast
            (
                DateOnly.FromDateTime(DateTime.Now.AddDays(index)),
                Random.Shared.Next(-20, 45),
                Summaries[Random.Shared.Next(Summaries.Length)]
            ))
            .ToArray();
    }
}
`
              }
            ]
          },
          {
            id: 'f-core-csproj',
            name: 'WeatherTracker.Core.csproj',
            path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Core/WeatherTracker.Core.csproj',
            relativePath: 'WeatherTracker.Core.csproj',
            extension: '.csproj',
            isDirectory: false,
            content: `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>

</Project>
`
          }
        ]
      },
      {
        id: 'proj-tests',
        name: 'WeatherTracker.Tests',
        path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Tests/WeatherTracker.Tests.csproj',
        targetFramework: 'net8.0',
        projectType: 'test',
        dependencies: {
          frameworks: ['Microsoft.NETCore.App'],
          packages: [
            { id: 'xunit', version: '2.6.6', resolvedVersion: '2.6.6', isDirect: true },
            { id: 'xunit.runner.visualstudio', version: '2.5.6', resolvedVersion: '2.5.6', isDirect: true },
            { id: 'Microsoft.NET.Test.Sdk', version: '17.8.0', resolvedVersion: '17.8.0', isDirect: true },
            { id: 'Moq', version: '4.20.70', resolvedVersion: '4.20.70', isDirect: true }
          ],
          projectReferences: ['WeatherTracker.Api', 'WeatherTracker.Core']
        },
        files: [
          {
            id: 'folder-unit-tests',
            name: 'UnitTests',
            path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Tests/UnitTests',
            relativePath: 'UnitTests',
            extension: '',
            isDirectory: true,
            children: [
              {
                id: 'f-users-ctrl-tests',
                name: 'UsersControllerTests.cs',
                path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Tests/UnitTests/UsersControllerTests.cs',
                relativePath: 'UnitTests/UsersControllerTests.cs',
                extension: '.cs',
                isDirectory: false,
                content: `using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Moq;
using WeatherTracker.Api.Controllers;
using WeatherTracker.Core.Models;
using WeatherTracker.Core.Services;
using Xunit;

namespace WeatherTracker.Tests.UnitTests;

public class UsersControllerTests
{
    private readonly Mock<IUserService> _mockService;
    private readonly Mock<ILogger<UsersController>> _mockLogger;
    private readonly UsersController _controller;

    public UsersControllerTests()
    {
        _mockService = new Mock<IUserService>();
        _mockLogger = new Mock<ILogger<UsersController>>();
        _controller = new UsersController(_mockService.Object, _mockLogger.Object);
    }

    [Fact]
    public void Get_ReturnsOkResult_WhenUserExists()
    {
        // Arrange
        var testUser = new User { Id = 42, Name = "Grace Hopper", Email = "grace@navy.mil" };
        _mockService.Setup(s => s.GetUserById(42)).Returns(testUser);

        // Act
        var result = _controller.Get(42);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result);
        var returnUser = Assert.IsType<User>(okResult.Value);
        Assert.Equal("Grace Hopper", returnUser.Name);
    }

    [Fact]
    public void Get_ReturnsNotFound_WhenUserDoesNotExist()
    {
        // Arrange
        _mockService.Setup(s => s.GetUserById(999)).Returns((User?)null);

        // Act
        var result = _controller.Get(999);

        // Assert
        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Theory]
    [InlineData("Linus Torvalds", "linus@kernel.org")]
    [InlineData("Dennis Ritchie", "dennis@bell-labs.com")]
    public void Create_ReturnsCreatedAtAction_WhenValid(string name, string email)
    {
        // Arrange
        var req = new CreateUserRequest(name, email);
        _mockService.Setup(s => s.CreateUser(name, email))
            .Returns(new User { Id = 10, Name = name, Email = email });

        // Act
        var result = _controller.Create(req);

        // Assert
        var createdResult = Assert.IsType<CreatedAtActionResult>(result);
        Assert.Equal(201, createdResult.StatusCode);
    }
}
`
              },
              {
                id: 'f-weather-service-tests',
                name: 'WeatherServiceTests.cs',
                path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Tests/UnitTests/WeatherServiceTests.cs',
                relativePath: 'UnitTests/WeatherServiceTests.cs',
                extension: '.cs',
                isDirectory: false,
                content: `using WeatherTracker.Core.Services;
using Xunit;

namespace WeatherTracker.Tests.UnitTests;

public class WeatherServiceTests
{
    [Fact]
    public void GetForecasts_ReturnsFiveDaysOfForecasts()
    {
        // Arrange
        var service = new WeatherService();

        // Act
        var forecasts = service.GetForecasts().ToList();

        // Assert
        Assert.Equal(5, forecasts.Count);
        Assert.All(forecasts, f => Assert.False(string.IsNullOrEmpty(f.Summary)));
    }
}
`
              }
            ]
          },
          {
            id: 'f-tests-csproj',
            name: 'WeatherTracker.Tests.csproj',
            path: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Tests/WeatherTracker.Tests.csproj',
            relativePath: 'WeatherTracker.Tests.csproj',
            extension: '.csproj',
            isDirectory: false,
            content: `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <IsPackable>false</IsPackable>
    <IsTestProject>true</IsTestProject>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.8.0" />
    <PackageReference Include="xunit" Version="2.6.6" />
    <PackageReference Include="xunit.runner.visualstudio" Version="2.5.6" />
    <PackageReference Include="Moq" Version="4.20.70" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\\WeatherTracker.Api\\WeatherTracker.Api.csproj" />
    <ProjectReference Include="..\\WeatherTracker.Core\\WeatherTracker.Core.csproj" />
  </ItemGroup>

</Project>
`
          }
        ]
      }
    ]
  },
  {
    name: 'MiniStore.slnx',
    path: '/Users/developer/Projects/MiniStore/MiniStore.slnx',
    format: 'slnx',
    projects: [
      {
        id: 'proj-store-api',
        name: 'MiniStore.CatalogApi',
        path: '/Users/developer/Projects/MiniStore/MiniStore.CatalogApi/MiniStore.CatalogApi.csproj',
        targetFramework: 'net9.0',
        projectType: 'webapi',
        dependencies: {
          frameworks: ['Microsoft.AspNetCore.App'],
          packages: [
            { id: 'Microsoft.AspNetCore.OpenApi', version: '9.0.0', resolvedVersion: '9.0.0', isDirect: true }
          ],
          projectReferences: ['MiniStore.Shared']
        },
        launchSettings: {
          profiles: {
            'MiniStore.CatalogApi': {
              commandName: 'Project',
              dotnetRunMessages: true,
              applicationUrl: 'http://localhost:5200'
            }
          }
        },
        files: [
          {
            id: 'f-store-program',
            name: 'Program.cs',
            path: '/Users/developer/Projects/MiniStore/MiniStore.CatalogApi/Program.cs',
            relativePath: 'Program.cs',
            extension: '.cs',
            isDirectory: false,
            content: `var builder = WebApplication.CreateBuilder(args);
builder.Services.AddOpenApi();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.MapGet("/catalog/items", () => new[]
{
    new { Id = 1, Name = "MacBook Pro M3 Max", Price = 3499.00 },
    new { Id = 2, Name = "Apple Studio Display", Price = 1599.00 }
});

app.Run();
`
          },
          {
            id: 'f-store-csproj',
            name: 'MiniStore.CatalogApi.csproj',
            path: '/Users/developer/Projects/MiniStore/MiniStore.CatalogApi/MiniStore.CatalogApi.csproj',
            relativePath: 'MiniStore.CatalogApi.csproj',
            extension: '.csproj',
            isDirectory: false,
            content: `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="9.0.0" />
  </ItemGroup>
</Project>
`
          }
        ]
      }
    ]
  }
];

export const INITIAL_TESTS: TestItem[] = [
  {
    id: 'test-1',
    projectName: 'WeatherTracker.Tests',
    namespace: 'WeatherTracker.Tests.UnitTests',
    className: 'UsersControllerTests',
    methodName: 'Get_ReturnsOkResult_WhenUserExists',
    fullName: 'WeatherTracker.Tests.UnitTests.UsersControllerTests.Get_ReturnsOkResult_WhenUserExists',
    status: 'passed',
    durationMs: 14
  },
  {
    id: 'test-2',
    projectName: 'WeatherTracker.Tests',
    namespace: 'WeatherTracker.Tests.UnitTests',
    className: 'UsersControllerTests',
    methodName: 'Get_ReturnsNotFound_WhenUserDoesNotExist',
    fullName: 'WeatherTracker.Tests.UnitTests.UsersControllerTests.Get_ReturnsNotFound_WhenUserDoesNotExist',
    status: 'passed',
    durationMs: 9
  },
  {
    id: 'test-3',
    projectName: 'WeatherTracker.Tests',
    namespace: 'WeatherTracker.Tests.UnitTests',
    className: 'UsersControllerTests',
    methodName: 'Create_ReturnsCreatedAtAction_WhenValid(name: "Linus Torvalds", email: "linus@kernel.org")',
    fullName: 'WeatherTracker.Tests.UnitTests.UsersControllerTests.Create_ReturnsCreatedAtAction_WhenValid_1',
    status: 'passed',
    durationMs: 18
  },
  {
    id: 'test-4',
    projectName: 'WeatherTracker.Tests',
    namespace: 'WeatherTracker.Tests.UnitTests',
    className: 'UsersControllerTests',
    methodName: 'Create_ReturnsCreatedAtAction_WhenValid(name: "Dennis Ritchie", email: "dennis@bell-labs.com")',
    fullName: 'WeatherTracker.Tests.UnitTests.UsersControllerTests.Create_ReturnsCreatedAtAction_WhenValid_2',
    status: 'passed',
    durationMs: 12
  },
  {
    id: 'test-5',
    projectName: 'WeatherTracker.Tests',
    namespace: 'WeatherTracker.Tests.UnitTests',
    className: 'WeatherServiceTests',
    methodName: 'GetForecasts_ReturnsFiveDaysOfForecasts',
    fullName: 'WeatherTracker.Tests.UnitTests.WeatherServiceTests.GetForecasts_ReturnsFiveDaysOfForecasts',
    status: 'passed',
    durationMs: 22
  }
];

export const MOCK_DIAGNOSTICS: DiagnosticItem[] = [
  {
    id: 'diag-1',
    code: 'CS8618',
    message: "Non-nullable property 'Name' must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.",
    file: '/Users/developer/Projects/WeatherTracker/WeatherTracker.Core/Models/User.cs',
    line: 5,
    column: 19,
    severity: 'info',
    source: 'Roslyn'
  }
];

export const POPULAR_NUGET_PACKAGES = [
  { id: 'Newtonsoft.Json', version: '13.0.3', description: 'Popular high-performance JSON framework for .NET', downloads: '1.4B' },
  { id: 'Serilog.AspNetCore', version: '8.0.0', description: 'Serilog logging provider for ASP.NET Core', downloads: '185M' },
  { id: 'Dapper', version: '2.1.28', description: 'High performance Micro-ORM supporting SQL Server, PostgreSQL, SQLite', downloads: '320M' },
  { id: 'MediatR', version: '12.2.0', description: 'Simple, unambitious mediator implementation in .NET', downloads: '240M' },
  { id: 'FluentValidation', version: '11.9.0', description: 'A popular .NET library for building strongly-typed validation rules', downloads: '280M' },
  { id: 'Polly', version: '8.3.0', description: 'Resilience and transient-fault-handling library (Circuit Breaker, Retry)', downloads: '190M' },
  { id: 'AutoMapper', version: '13.0.1', description: 'A convention-based object-object mapper in .NET', downloads: '310M' },
  { id: 'Microsoft.EntityFrameworkCore', version: '8.0.2', description: 'Entity Framework Core is a modern object-database mapper for .NET', downloads: '450M' }
];
