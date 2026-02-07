import { Component, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScrollTriggerDirective } from '../../directives/scroll-trigger.directive';

interface Project {
    title: string;
    description: string;
    technologies: string[];
    imageUrl: string;
    githubUrl?: string;
    demoUrl?: string;
    accentColor: string;
}

@Component({
    selector: 'app-projects',
    standalone: true,
    imports: [CommonModule, ScrollTriggerDirective],
    templateUrl: './projects.component.html',
    styleUrls: ['./projects.component.css']
})
export class ProjectsComponent {
    scrollOffset = 0;

    @HostListener('window:scroll', [])
    onWindowScroll() {
        // Obtenir la position de la section pour un parallaxe relatif
        const section = document.getElementById('projects');
        if (section) {
            const rect = section.getBoundingClientRect();
            // On commence à calculer quand la section est visible
            this.scrollOffset = window.innerHeight - rect.top;
        }
    }

    projects: Project[] = [
        {
            title: 'POPUPS-GAME',
            description: 'Un jeu interactif addictif basé sur des pop-ups dynamiques, mettant à l\'épreuve les réflexes et l\'agilité des joueurs.',
            technologies: ['TypeScript', 'Canvas API', 'SCSS', 'Game Design'],
            imageUrl: 'assets/images/popgame.png',
            githubUrl: 'https://github.com/kibagami-nc/POPUPS-GAME',
            accentColor: '#9AC8EB'
        },
        {
            title: 'Ngrok Tunnel Utility',
            description: 'Une solution de tunneling réseau robuste permettant d\'exposer des serveurs locaux sur le web de manière sécurisée.',
            technologies: ['Networking', 'Ngrok API', 'Automation', 'Security'],
            imageUrl: 'assets/images/ngrok.png',
            githubUrl: 'https://github.com/kibagami-nc/Ngrok_Tunnel',
            accentColor: '#F4CFDF'
        },
        {
            title: 'POPUPS-WEB',
            description: 'Extension web du concept POPUPS, explorant des mécaniques d\'interface innovantes et une expérience utilisateur immersive.',
            technologies: ['HTML5', 'CSS3', 'JavaScript', 'Web APIs'],
            imageUrl: 'assets/images/popweb.png',
            githubUrl: 'https://github.com/kibagami-nc/POPUPS-WEB',
            accentColor: '#F7F6CF'
        },
        {
            title: 'Maintenance Serveur Linux Perso',
            description: 'Administration avancée et maintenance préventive d\'une infrastructure Ubuntu Server (mises à jour, sécurité, monitoring).',
            technologies: ['Ubuntu', 'Bash', 'SSH', 'Security Hardening'],
            imageUrl: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?auto=format&fit=crop&q=80&w=1000',
            accentColor: '#B6D8F2'
        }
    ];
}
