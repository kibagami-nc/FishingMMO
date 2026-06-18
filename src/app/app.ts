import { Component, signal, ViewEncapsulation } from '@angular/core';
import { Game } from './game/game';

@Component({
  selector: 'app-root',
  imports: [Game],
  templateUrl: './app.html',
  styleUrl: './app.css',
  // None: the hotbar/inventory slots are injected via innerHTML and have no scoping
  // attribute, so the HUD CSS must be global to reach them.
  encapsulation: ViewEncapsulation.None,
})
export class App {
  protected readonly title = signal('FishingMMO');
}
