import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { catchError, concatMap, debounceTime, EMPTY, map, of, Subject, switchMap, tap } from 'rxjs';

interface DocumentResponse {
  content: string;
  isProtected: boolean;
}

interface DocumentAccessResponse {
  token: string;
  expiresAt: string;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

@Component({
  selector: 'app-document-editor',
  imports: [FormsModule],
  templateUrl: './document-editor.html',
  styleUrl: './document-editor.css',
})
export class DocumentEditor implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly changes = new Subject<{ slug: string; content: string; revision: number }>();
  private revision = 0;
  private token: string | null = null;
  private draft: string | null = null;

  readonly slug = signal('');
  readonly content = signal('');
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly status = signal<SaveStatus>('idle');
  readonly exists = signal(false);
  readonly isProtected = signal(false);
  readonly locked = signal(false);
  readonly showProtection = signal(false);
  readonly passwordBusy = signal(false);
  readonly passwordError = signal('');
  unlockPassword = '';
  newPassword = '';
  confirmPassword = '';

  ngOnInit(): void {
    this.changes
      .pipe(
        debounceTime(500),
        concatMap(({ slug, content, revision }) => {
          if (slug !== this.slug() || this.locked()) return EMPTY;
          return this.http
            .put<DocumentResponse>(
              this.documentUrl(slug),
              { content },
              {
                headers: this.tokenHeaders(),
              },
            )
            .pipe(
              tap((document) => {
                if (this.slug() !== slug) return;
                this.exists.set(true);
                this.isProtected.set(document.isProtected);
                if (this.revision === revision) {
                  this.draft = null;
                  this.status.set('saved');
                }
              }),
              catchError((error: HttpErrorResponse) => {
                if (this.slug() === slug) {
                  if (error.status === 401) {
                    this.draft = this.content();
                    this.lockDocument(
                      'Seu acesso expirou ou o documento foi protegido. Desbloqueie para continuar.',
                    );
                  } else if (this.revision === revision) {
                    this.status.set('error');
                  }
                }
                return EMPTY;
              }),
            );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();

    this.route.paramMap
      .pipe(
        map((params) => params.get('slug') ?? ''),
        tap((slug) => {
          this.revision++;
          this.slug.set(slug);
          this.content.set('');
          this.draft = null;
          this.token = this.readToken(slug);
          this.status.set('idle');
          this.loadError.set('');
          this.loading.set(true);
          this.exists.set(false);
          this.isProtected.set(false);
          this.locked.set(false);
          this.passwordBusy.set(false);
          this.closeProtection();
          this.unlockPassword = '';
        }),
        switchMap((slug) => {
          if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(slug)) {
            this.loadError.set('Use de 1 a 100 caracteres: letras, números, _ ou -.');
            this.loading.set(false);
            return EMPTY;
          }
          return this.fetchDocument(slug);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((document) => this.applyDocument(document));
  }

  onInput(event: Event): void {
    this.content.set((event.target as HTMLTextAreaElement).value);
    this.queueSave();
  }

  openProtection(): void {
    this.passwordError.set('');
    this.showProtection.set(true);
  }

  closeProtection(): void {
    this.showProtection.set(false);
    this.passwordError.set('');
    this.newPassword = '';
    this.confirmPassword = '';
  }

  protect(): void {
    if (this.passwordBusy() || !this.exists() || this.status() === 'saving') return;
    if (this.newPassword.length < 6 || this.newPassword.length > 128) {
      this.passwordError.set('A senha deve ter entre 6 e 128 caracteres.');
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.passwordError.set('As senhas não coincidem.');
      return;
    }

    const slug = this.slug();
    this.passwordBusy.set(true);
    this.passwordError.set('');
    this.http
      .post<DocumentAccessResponse>(
        `${this.documentUrl(slug)}/password`,
        {
          password: this.newPassword,
        },
        { headers: this.tokenHeaders() },
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (access) => {
          this.storeToken(slug, access.token);
          if (this.slug() !== slug) return;
          this.isProtected.set(true);
          this.passwordBusy.set(false);
          this.closeProtection();
        },
        error: (error: HttpErrorResponse) => {
          if (this.slug() !== slug) return;
          this.passwordBusy.set(false);
          if (error.status === 401 || error.status === 409) {
            this.closeProtection();
            this.lockDocument('Este documento já foi protegido. Informe a senha para continuar.');
          } else {
            this.passwordError.set('Não foi possível proteger o documento. Tente novamente.');
          }
        },
      });
  }

  unlock(): void {
    if (this.passwordBusy() || !this.unlockPassword) return;
    const slug = this.slug();
    this.passwordBusy.set(true);
    this.passwordError.set('');
    this.http
      .post<DocumentAccessResponse>(`${this.documentUrl(slug)}/unlock`, {
        password: this.unlockPassword,
      })
      .pipe(
        tap((access) => this.storeToken(slug, access.token)),
        switchMap(() => (this.slug() === slug ? this.fetchDocument(slug) : EMPTY)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (document) => {
          if (this.slug() !== slug) return;
          this.passwordBusy.set(false);
          this.unlockPassword = '';
          this.applyDocument(document);
        },
        error: (error: HttpErrorResponse) => {
          if (this.slug() !== slug) return;
          this.passwordBusy.set(false);
          this.unlockPassword = '';
          this.passwordError.set(
            error.status === 401
              ? 'Senha incorreta.'
              : 'Não foi possível desbloquear. Tente novamente.',
          );
        },
      });
  }

  private fetchDocument(slug: string) {
    return this.http
      .get<DocumentResponse>(this.documentUrl(slug), { headers: this.tokenHeaders() })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          if (error.status === 401) {
            this.lockDocument();
          } else if (error.status !== 404) {
            this.loadError.set('Não foi possível carregar o documento. Tente atualizar a página.');
          }
          return of(null);
        }),
      );
  }

  private applyDocument(document: DocumentResponse | null): void {
    this.loading.set(false);
    if (!document) {
      if (!this.locked()) this.content.set('');
      return;
    }
    this.locked.set(false);
    this.exists.set(true);
    this.isProtected.set(document.isProtected);
    this.loadError.set('');
    this.passwordError.set('');
    this.content.set(this.draft ?? document.content);
    if (this.draft !== null) this.queueSave();
  }

  private queueSave(): void {
    this.revision++;
    this.status.set('saving');
    this.changes.next({ slug: this.slug(), content: this.content(), revision: this.revision });
  }

  private lockDocument(message = ''): void {
    this.token = null;
    try {
      sessionStorage.removeItem(this.tokenKey(this.slug()));
    } catch {
      /* Storage may be blocked. */
    }
    this.content.set('');
    this.locked.set(true);
    this.isProtected.set(true);
    this.exists.set(true);
    this.loading.set(false);
    this.passwordError.set(message);
    this.status.set('idle');
  }

  private documentUrl(slug: string): string {
    return `/api/documents/${encodeURIComponent(slug)}`;
  }

  private tokenKey(slug: string): string {
    return `we-text:document-token:${slug}`;
  }

  private readToken(slug: string): string | null {
    try {
      return sessionStorage.getItem(this.tokenKey(slug));
    } catch {
      return null;
    }
  }

  private storeToken(slug: string, token: string): void {
    if (this.slug() === slug) this.token = token;
    try {
      sessionStorage.setItem(this.tokenKey(slug), token);
    } catch {
      /* Keep access in memory for this page. */
    }
  }

  private tokenHeaders(): Record<string, string> {
    return this.token ? { 'X-Document-Token': this.token } : {};
  }
}
