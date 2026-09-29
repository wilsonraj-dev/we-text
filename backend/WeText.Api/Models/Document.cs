namespace WeText.Api.Models;

public class Document
{
    public Guid Id { get; set; }
    public required string Slug { get; set; }
    public string Content { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

