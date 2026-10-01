using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using WeText.Api.Data;
using WeText.Api.Models;
using WeText.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddScoped<IPasswordHasher<Document>, PasswordHasher<Document>>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<DocumentTokenStore>();
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Postgres")));
builder.Services.AddCors(options => options.AddPolicy("AngularDev", policy =>
    policy.WithOrigins("http://localhost:4200").AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

app.UseCors("AngularDev");
app.MapControllers();

app.Run();
