import { Component, HostListener, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TicTacToeComponent } from '../tic-tac-toe/tic-tac-toe.component';

@Component({
    selector: 'app-hero',
    standalone: true,
    imports: [CommonModule, TicTacToeComponent],
    templateUrl: './hero.component.html',
    styleUrls: ['./hero.component.css']
})
export class HeroComponent {
    @Output() openApps = new EventEmitter<void>();
    scrollOffset = 0;

    @HostListener('window:scroll', [])
    onWindowScroll() {
        this.scrollOffset = window.scrollY;
    }
}
