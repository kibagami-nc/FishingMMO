import { Component, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'app-hero',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './hero.component.html',
    styleUrls: ['./hero.component.css']
})
export class HeroComponent {
    scrollOffset = 0;

    @HostListener('window:scroll', [])
    onWindowScroll() {
        this.scrollOffset = window.scrollY;
    }
}
