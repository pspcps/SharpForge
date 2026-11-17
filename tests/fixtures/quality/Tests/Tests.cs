using Xunit;
public class Tests {
    private int unusedField;
    [Fact] public void Passes() { Assert.Equal(4, new Calc().Add(2, 2)); }
    [Fact] public void Fails() { Assert.Equal(5, new Calc().Add(2, 2)); }
}
