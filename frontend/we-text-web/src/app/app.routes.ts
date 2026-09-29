import { Routes } from '@angular/router';
import { DocumentEditor } from './document-editor';

export const routes: Routes = [
  { path: '', redirectTo: 'inicio', pathMatch: 'full' },
  { path: ':slug', component: DocumentEditor },
];
