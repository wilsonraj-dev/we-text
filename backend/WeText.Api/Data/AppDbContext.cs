using Microsoft.EntityFrameworkCore;
using WeText.Api.Models;

namespace WeText.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Document> Documents => Set<Document>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Document>(entity =>
        {
            entity.HasKey(document => document.Id);
            entity.Property(document => document.Slug).HasMaxLength(100).IsRequired();
            entity.Property(document => document.Content).IsRequired();
            entity.HasIndex(document => document.Slug).IsUnique();
        });
    }
}

