using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using WeText.Api.Data;
using WeText.Api.DTOs;
using WeText.Api.Models;

namespace WeText.Api.Controllers;

[ApiController]
[Route("api/documents")]
public class DocumentsController(AppDbContext db) : ControllerBase
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

        return document is null ? NotFound() : Ok(ToResponse(document));
    }

    [HttpPut("{slug}")]
    public async Task<ActionResult<DocumentResponse>> Put(
        string slug, [FromBody] SaveDocumentRequest? request, CancellationToken cancellationToken)
    {
        if (!IsValidSlug(slug))
            return BadRequest("O slug deve ter de 1 a 100 caracteres: letras, números, _ ou -.");
        if (request?.Content is null)
            return BadRequest("O campo content é obrigatório.");

        var document = await db.Documents.SingleOrDefaultAsync(
            item => item.Slug == slug, cancellationToken);
        if (document is not null)
        {
            document.Content = request.Content;
            document.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            return Ok(ToResponse(document));
        }

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
            document = await db.Documents.SingleAsync(item => item.Slug == slug, cancellationToken);
            document.Content = request.Content;
            document.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            return Ok(ToResponse(document));
        }
    }

    private static bool IsValidSlug(string slug) => SlugPattern.IsMatch(slug);

    private static DocumentResponse ToResponse(Document document) => new(
        document.Id, document.Slug, document.Content, document.CreatedAt, document.UpdatedAt);
}
