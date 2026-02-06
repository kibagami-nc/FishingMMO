import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HeroComponent } from './components/hero/hero.component';
import { PresentationComponent } from './components/presentation/presentation.component';
import { NavbarComponent } from './components/navbar/navbar.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, HeroComponent, PresentationComponent, NavbarComponent],
  template: `
    <main class="relative z-10">
      <app-navbar></app-navbar>
      <app-hero id="hero"></app-hero>
      <app-presentation id="presentation"></app-presentation>
    </main>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class AppComponent { }
