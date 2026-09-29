import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { catchError, concatMap, debounceTime, EMPTY, map, of, Subject, switchMap, tap } from 'rxjs';

interface DocumentResponse {
  content: string;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

@Component({
  selector: 'app-document-editor',
  templateUrl: './document-editor.html',
  styleUrl: './document-editor.css',
})
export class DocumentEditor implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly changes = new Subject<{ slug: string; content: string }>();

  readonly slug = signal('');
  readonly content = signal('');
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly status = signal<SaveStatus>('idle');

  ngOnInit(): void {
    this.changes.pipe(
      debounceTime(500),
      concatMap(({ slug, content }) =>
        this.http.put<DocumentResponse>(`/api/documents/${encodeURIComponent(slug)}`, { content }).pipe(
          tap(() => {
            if (this.slug() === slug && this.content() === content) {
              this.status.set('saved');
            }
          }),
          catchError(() => {
            if (this.slug() === slug) {
              this.status.set('error');
            }
            return EMPTY;
          }),
        ),
      ),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe();

    this.route.paramMap.pipe(
      map((params) => params.get('slug') ?? ''),
      tap((slug) => {
        this.slug.set(slug);
        this.content.set('');
        this.status.set('idle');
        this.loadError.set('');
        this.loading.set(true);
      }),
      switchMap((slug) => {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(slug)) {
          this.loadError.set('Use de 1 a 100 caracteres: letras, números, _ ou -.');
          this.loading.set(false);
          return EMPTY;
        }

        return this.http.get<DocumentResponse>(`/api/documents/${encodeURIComponent(slug)}`).pipe(
          catchError((error: HttpErrorResponse) => {
            if (error.status !== 404) {
              this.loadError.set('Não foi possível carregar o documento. Tente atualizar a página.');
            }
            return of(null);
          }),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((document) => {
      this.content.set(document?.content ?? '');
      this.loading.set(false);
    });
  }

  onInput(event: Event): void {
    const content = (event.target as HTMLTextAreaElement).value;
    this.content.set(content);
    this.status.set('saving');
    this.changes.next({ slug: this.slug(), content });
  }
}
