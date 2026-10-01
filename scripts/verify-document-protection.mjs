import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Uses the local API and Compose database from the README. Only test documents are removed.
const root = fileURLToPath(new URL('../', import.meta.url));
const prefix = `verification-${randomUUID()}`;
const slugs = [prefix, `${prefix}-other`, `${prefix}-public`];
const password = 'Senha-apenas-para-teste';

async function request(slug, method = 'GET', body, token) {
    const response = await fetch(`http://localhost:5036/api/documents/${slug}`, {
        method,
        headers: {
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(token ? { 'X-Document-Token': token } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    assert(!text.toLowerCase().includes('passwordhash'), 'A API não pode expor PasswordHash.');
    const data = text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text;
    return { status: response.status, data, headers: response.headers };
}

try {
    assert.equal((await request(slugs[0])).status, 404);
    for (const slug of slugs) {
        assert.equal((await request(slug, 'PUT', { content: 'Conteúdo de teste' })).status, 201);
    }
    assert.equal((await request(`${slugs[0]}/password`, 'POST', { password: '12345' })).status, 400);
    const protectedDocument = await request(`${slugs[0]}/password`, 'POST', { password });
    assert.equal(protectedDocument.status, 200);
    const token = protectedDocument.data.token;
    assert.match(token, /^[A-F0-9]{64}$/);
    assert(Math.abs(Date.parse(protectedDocument.data.expiresAt) - Date.now() - 6 * 3600000) < 10000);
    const locked = await request(slugs[0]);
    assert.equal(locked.status, 401);
    assert.deepEqual(locked.data, { slug: slugs[0], isProtected: true });
    assert.equal((await request(slugs[0], 'PUT', { content: 'Sem autorização' })).status, 401);
    assert.equal((await request(slugs[0], 'GET', undefined, 'invalid')).status, 401);
    assert.equal((await request(slugs[0], 'PUT', { content: 'Token inválido' }, 'invalid')).status, 401);
    const authorized = await request(slugs[0], 'GET', undefined, token);
    assert.equal(authorized.status, 200);
    assert.equal(authorized.data.content, 'Conteúdo de teste');
    assert(authorized.headers.get('cache-control').includes('no-store'));
    assert.equal((await request(slugs[0], 'PUT', { content: 'Edição autorizada' }, token)).status, 200);
    assert.equal((await request(`${slugs[0]}/unlock`, 'POST', { password: 'incorreta' })).status, 401);
    const unlocked = await request(`${slugs[0]}/unlock`, 'POST', { password });
    assert.equal(unlocked.status, 200);
    assert.notEqual(unlocked.data.token, token);
    assert.equal((await request(slugs[0], 'GET', undefined, unlocked.data.token)).data.content, 'Edição autorizada');
    assert.equal((await request(`${slugs[0]}/password`, 'POST', { password }, token)).status, 409);
    assert.equal((await request(`${slugs[0]}/password`, 'POST', { password })).status, 401);
    assert.equal((await request(`${slugs[1]}/password`, 'POST', { password })).status, 200);
    assert.equal((await request(slugs[1], 'GET', undefined, token)).status, 401);
    assert.equal((await request(slugs[1], 'PUT', { content: 'Token de outro documento' }, token)).status, 401);
    assert.equal((await request(slugs[2])).data.isProtected, false);
    assert.equal((await request(slugs[2], 'PUT', { content: 'Documento ainda público' })).status, 200);
    console.log('Proteção de leitura e gravação, senhas, tokens e documentos públicos: OK.');
} finally {
    // Slugs contain only a generated UUID and fixed suffixes, never user input.
    const sql = `DELETE FROM "Documents" WHERE "Slug" IN (${slugs.map(slug => `'${slug}'`).join(', ')});`;
    execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'wetext', '-d', 'wetext', '-c', sql], {
        cwd: root,
        stdio: 'pipe',
    });
}
