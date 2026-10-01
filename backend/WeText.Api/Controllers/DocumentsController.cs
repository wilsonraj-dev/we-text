using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using WeText.Api.Data;
using WeText.Api.DTOs;
using WeText.Api.Models;
using WeText.Api.Services;

namespace WeText.Api.Controllers;

[ApiController]
[Route("api/documents")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public class DocumentsController(
    AppDbContext db, IPasswordHasher<Document> passwordHasher, DocumentTokenStore tokens) : ControllerBase
{
    private static readonly Regex SlugPattern = new(
        "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    [HttpGet("{slug}")]
    public async Task<ActionResult<DocumentResponse>> Get(string slug, CancellationToken cancellationToken)
    {
        if (!IsValidSlug(slug))
            return BadRequest("O slug deve ter de 1 a 100 caracteres: letras, números, _ ou -.");

        var document = await db.Documents.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Slug == slug, cancellationToken);

        if (document is null)
            return NotFound();
        if (!CanAccess(document))
            return ProtectedDocument(slug);

        return Ok(ToResponse(document));
    }

    [HttpPut("{slug}")]
    public async Task<ActionResult<DocumentResponse>> Put(
        string slug, [FromBody] SaveDocumentRequest? request, CancellationToken cancellationToken)
    {
        if (!IsValidSlug(slug))
            return BadRequest("O slug deve ter de 1 a 100 caracteres: letras, números, _ ou -.");
        if (request?.Content is null)
            return BadRequest("O campo content é obrigatório.");

        var document = await db.Documents.AsNoTracking().SingleOrDefaultAsync(
            item => item.Slug == slug, cancellationToken);
        if (document is not null)
            return await UpdateContent(document, request.Content, cancellationToken);

        var now = DateTime.UtcNow;
        document = new Document
        {
            Id = Guid.NewGuid(),
            Slug = slug,
            Content = request.Content,
            CreatedAt = now,
            UpdatedAt = now
        };
        db.Documents.Add(document);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return CreatedAtAction(nameof(Get), new { slug }, ToResponse(document));
        }
        catch (DbUpdateException exception) when (
            exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // Another request created this slug between the read and insert.
            db.ChangeTracker.Clear();
            document = await db.Documents.AsNoTracking().SingleAsync(item => item.Slug == slug, cancellationToken);
            return await UpdateContent(document, request.Content, cancellationToken);
        }
    }

    [HttpPost("{slug}/unlock")]
    public async Task<ActionResult<DocumentAccessResponse>> Unlock(
        string slug, [FromBody] DocumentPasswordRequest? request, CancellationToken cancellationToken)
    {
        if (!IsValidSlug(slug))
            return BadRequest("Slug inválido.");

        if (string.IsNullOrEmpty(request?.Password) || request.Password.Length > 128)
            return BadRequest("Informe uma senha de até 128 caracteres.");

        var document = await db.Documents.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Slug == slug, cancellationToken);

        if (document is null)
            return NotFound();

        if (document.PasswordHash is null)
            return BadRequest("Este documento não possui senha.");

        var result = passwordHasher.VerifyHashedPassword(document, document.PasswordHash, request.Password);
        if (result == PasswordVerificationResult.Failed)
            return Unauthorized(new { message = "Senha incorreta." });

        return Ok(tokens.Issue(document.Id));
    }

    [HttpPost("{slug}/password")]
    public async Task<ActionResult<DocumentAccessResponse>> SetPassword(
        string slug, [FromBody] DocumentPasswordRequest? request, CancellationToken cancellationToken)
    {
        if (!IsValidSlug(slug))
            return BadRequest("Slug inválido.");

        if (request?.Password is null || request.Password.Length is < 6 or > 128)
            return BadRequest("A senha deve ter entre 6 e 128 caracteres.");

        var document = await db.Documents.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Slug == slug, cancellationToken);

        if (document is null)
            return NotFound();

        if (!CanAccess(document))
            return ProtectedDocument(slug);

        if (document.PasswordHash is not null)
            return Conflict(new { message = "Este documento já possui senha." });

        var hash = passwordHasher.HashPassword(document, request.Password);
        
        var updated = await db.Documents
            .Where(item => item.Id == document.Id && item.PasswordHash == null)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(item => item.PasswordHash, hash)
                .SetProperty(item => item.UpdatedAt, DateTime.UtcNow), cancellationToken);
        
        if (updated == 0)
            return Conflict(new { message = "Este documento já possui senha." });

        return Ok(tokens.Issue(document.Id));
    }

    private async Task<ActionResult<DocumentResponse>> UpdateContent(
        Document document, string content, CancellationToken cancellationToken)
    {
        if (!CanAccess(document))
            return ProtectedDocument(document.Slug);

        var now = DateTime.UtcNow;
        
        var updated = await db.Documents
            .Where(item => item.Id == document.Id && item.PasswordHash == document.PasswordHash)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(item => item.Content, content)
                .SetProperty(item => item.UpdatedAt, now), cancellationToken);
        
        if (updated == 0)
            return ProtectedDocument(document.Slug);

        document.Content = content;
        document.UpdatedAt = now;
        return Ok(ToResponse(document));
    }

    private bool CanAccess(Document document) => document.PasswordHash is null ||
        tokens.IsValid(Request.Headers["X-Document-Token"].ToString(), document.Id);

    private UnauthorizedObjectResult ProtectedDocument(string slug) =>
        Unauthorized(new { slug, isProtected = true });

    private static bool IsValidSlug(string slug) => SlugPattern.IsMatch(slug);

    private static DocumentResponse ToResponse(Document document) => new(
        document.Id, document.Slug, document.Content, document.CreatedAt, document.UpdatedAt,
        document.PasswordHash is not null);
}
