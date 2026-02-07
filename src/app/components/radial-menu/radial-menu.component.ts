import { Component, HostListener, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

interface MenuItem {
    id: string;
    label: string;
    icon: string;
    angle: number;
    color: string;
}

@Component({
    selector: 'app-radial-menu',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './radial-menu.component.html',
    styleUrl: './radial-menu.component.css'
})
export class RadialMenuComponent {
    isOpen = false;
    position = { x: 0, y: 0 };
    mousePosition = { x: 0, y: 0 };

    menuItems: MenuItem[] = [
        { id: 'hero', label: 'Accueil', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', angle: 0, color: '#9AC8EB' },
        { id: 'presentation', label: 'Moi', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z', angle: 51.4, color: '#5784BA' },
        { id: 'skills', label: 'Skills', icon: 'M13 10V3L4 14h7v7l9-11h-7z', angle: 102.8, color: '#F4CFDF' },
        { id: 'certifications', label: 'Certifs', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z', angle: 154.2, color: '#B6D8F2' },
        { id: 'experience', label: 'Parcours', icon: 'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', angle: 205.6, color: '#F7F6CF' },
        { id: 'projects', label: 'Projets', icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4', angle: 257, color: '#9AC8EB' },
        { id: 'contact', label: 'Contact', icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', angle: 308.4, color: '#F4CFDF' }
    ];

    @HostListener('window:mousemove', ['$event'])
    onMouseMove(event: MouseEvent) {
        this.mousePosition = { x: event.clientX, y: event.clientY };
    }

    @HostListener('window:contextmenu', ['$event'])
    onContextMenu(event: MouseEvent) {
        event.preventDefault();
        this.position = { x: event.clientX, y: event.clientY };
        this.isOpen = true;
    }

    @HostListener('window:click', ['$event'])
    onWindowClick(event: MouseEvent) {
        if (this.isOpen && event.button === 0) {
            // Delay closing to allow navigateTo to execute
            setTimeout(() => {
                this.isOpen = false;
            }, 100);
        }
    }

    @HostListener('window:keydown', ['$event'])
    onKeyDown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            this.isOpen = false;
        }
    }

    navigateTo(sectionId: string) {
        const element = document.getElementById(sectionId);
        if (element) {
            // Use smooth scroll
            const offset = 0; // Adjust if needed
            const bodyRect = document.body.getBoundingClientRect().top;
            const elementRect = element.getBoundingClientRect().top;
            const elementPosition = elementRect - bodyRect;
            const offsetPosition = elementPosition - offset;

            window.scrollTo({
                top: offsetPosition,
                behavior: 'smooth'
            });
        }
        this.isOpen = false;
    }
}
