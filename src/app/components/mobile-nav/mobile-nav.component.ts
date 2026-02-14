import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

interface MenuItem {
    id: string;
    label: string;
    icon: string;
}

@Component({
    selector: 'app-mobile-nav',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './mobile-nav.component.html',
    styleUrl: './mobile-nav.component.css'
})
export class MobileNavComponent {
    isMenuOpen = false;
    menuItems: MenuItem[] = [
        { id: 'hero', label: 'Accueil', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
        { id: 'presentation', label: 'Moi', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
        { id: 'skills', label: 'Skills', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
        { id: 'experience', label: 'Parcours', icon: 'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
        { id: 'projects', label: 'Projets', icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4' },
        { id: 'contact', label: 'Contact', icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' }
    ];

    toggleMenu() {
        this.isMenuOpen = !this.isMenuOpen;
    }

    navigateTo(sectionId: string) {
        const element = document.getElementById(sectionId);
        if (element) {
            const bodyRect = document.body.getBoundingClientRect().top;
            const elementRect = element.getBoundingClientRect().top;
            const elementPosition = elementRect - bodyRect;
            const offsetPosition = elementPosition - 60;

            window.scrollTo({
                top: offsetPosition,
                behavior: 'smooth'
            });
            this.isMenuOpen = false;
        }
    }
}
