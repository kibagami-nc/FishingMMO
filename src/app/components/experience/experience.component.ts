import { Component, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScrollTriggerDirective } from '../../directives/scroll-trigger.directive';

interface ExperienceItem {
    title: string;
    organization: string;
    date: string;
    description: string;
    type: 'education' | 'job';
    tags?: string[];
    extraLinks?: { label: string; url: string }[];
}

@Component({
    selector: 'app-experience',
    standalone: true,
    imports: [CommonModule, ScrollTriggerDirective],
    templateUrl: './experience.component.html',
    styleUrls: ['./experience.component.css']
})
export class ExperienceComponent {
    education: ExperienceItem[] = [
        {
            title: 'BTS Services Informatiques aux Organisations (SIO)',
            organization: 'Lycée Dick Ukeiwé',
            date: '2023 - 2025',
            description: 'Option Solutions d\'Infrastructure, Systèmes et Réseaux (SISR). Apprentissage de l\'administration système, réseaux, développement et cybersécurité.',
            type: 'education',
            tags: ['Réseaux', 'Linux', 'Windows Server', 'Cisco', 'Développement']
        },
        {
            title: 'Baccalauréat Général',
            organization: 'Lycée Dick Ukeiwé',
            date: '2020 - 2023',
            description: 'Mathématiques Complémentaires, Anglais Monde Contemporain (AMC) et Numérique et Sciences Informatiques (NSI).',
            type: 'education',
            tags: ['Maths', 'Python', 'Web', 'Anglais']
        }
    ];

    experience: ExperienceItem[] = [
        {
            title: 'Alternance - Assistant développeur logiciel',
            organization: 'Skazy',
            date: 'Décembre 2025 - Décembre 2026  (12mois)',
            description: 'Maintenance et évolution de sites web et applications mobiles.',
            type: 'job',
            tags: ['Java Spring Boot', 'Angular', 'TypeScript', 'PostgreSQL', 'Git', 'CoffeeScript', 'Jade'],
            extraLinks: [
                { label: 'Bien me loger', url: 'https://www.bienmeloger.nc/' },
                { label: 'Argus.nc', url: 'https://www.argus.nc/' }
            ]
        },
        {
            title: 'Stage - Développeur logiciel',
            organization: 'Calédonienne de Solutions Business',
            date: 'Octobre 2025 - Novembre 2025 (1mois)',
            description: 'création d\'un intranet pour la gestion des cartes bancaires.',
            type: 'job',
            tags: ['HTML/CSS', 'Angular', 'Java Spring Boot', 'TypeScript']
        }
    ];

    scrollOffset = 0;

    @HostListener('window:scroll', [])
    onWindowScroll() {
        this.scrollOffset = window.scrollY;
    }
}
