namespace WeText.Api.DTOs;

public sealed record DocumentAccessResponse(string Token, DateTimeOffset ExpiresAt);
