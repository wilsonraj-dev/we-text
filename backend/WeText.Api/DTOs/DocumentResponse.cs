namespace WeText.Api.DTOs;

public sealed record DocumentResponse(
    Guid Id,
    string Slug,
    string Content,
    DateTime CreatedAt,
    DateTime UpdatedAt);

