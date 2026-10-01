using System.Collections.Concurrent;
using System.Security.Cryptography;
using WeText.Api.DTOs;

namespace WeText.Api.Services;

public sealed class DocumentTokenStore(TimeProvider timeProvider)
{
    private sealed record Access(Guid DocumentId, DateTimeOffset Expiration);
    private readonly ConcurrentDictionary<string, Access> tokens = new();

    public DocumentAccessResponse Issue(Guid documentId)
    {
        var now = timeProvider.GetUtcNow();
        foreach (var entry in tokens)
        {
            if (entry.Value.Expiration <= now)
                tokens.TryRemove(entry.Key, out _);
        }

        var expiration = now.AddHours(6);
        string token;
        do
        {
            token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        } while (!tokens.TryAdd(token, new Access(documentId, expiration)));

        return new DocumentAccessResponse(token, expiration);
    }

    public bool IsValid(string? token, Guid documentId)
    {
        if (token is null || token.Length != 64 || !tokens.TryGetValue(token, out var access))
            return false;

        if (access.Expiration <= timeProvider.GetUtcNow())
        {
            tokens.TryRemove(token, out _);
            return false;
        }

        return access.DocumentId == documentId;
    }
}
