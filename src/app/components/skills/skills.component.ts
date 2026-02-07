import { Component, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScrollTriggerDirective } from '../../directives/scroll-trigger.directive';

interface Skill {
  name: string;
  icon: string;
  description: string;
}

@Component({
  selector: 'app-skills',
  standalone: true,
  imports: [CommonModule, ScrollTriggerDirective],
  templateUrl: './skills.component.html',
  styleUrls: ['./skills.component.css']
})
export class SkillsComponent {
  scrollOffset = 0;

  @HostListener('window:scroll', [])
  onWindowScroll() {
    this.scrollOffset = window.scrollY;
  }

  skills: Skill[] = [
    { name: 'Angular', icon: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/angularjs/angularjs-original.svg', description: 'Architecture robuste basée sur les composants pour créer des applications web scalables et performantes.' },
    { name: 'TypeScript', icon: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/typescript/typescript-original.svg', description: 'Développement typé sécurisé permettant une meilleure maintenabilité et une réduction drastique des bugs.' },
    { name: 'Node.js', icon: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nodejs/nodejs-original.svg', description: 'Moteur d\'exécution JavaScript ultra-rapide côté serveur pour des APIs asynchrones et modulaires.' },
    { name: 'Docker', icon: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/docker/docker-original.svg', description: 'Conteneurisation d\'environnements pour garantir une cohérence parfaite entre développement et production.' },
    { name: 'Git', icon: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/git/git-original.svg', description: 'Maîtrise complète du workflow (branching, merging) pour une collaboration fluide et efficace en équipe.' },
    { name: 'Tailwind CSS', icon: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/tailwindcss/tailwindcss-original.svg', description: 'Conception d\'interfaces modernes et responsives avec une approche utilitaire hautement personnalisable.' },
    { name: 'Linux', icon: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/linux/linux-original.svg', description: 'Maîtrise de l\'administration système et de la ligne de commande pour le déploiement et l\'automatisation.' },
    { name: 'GitHub', icon: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/github/github-original.svg', description: 'Gestion de projets, CI/CD avancée avec GitHub Actions et revue de code rigoureuse via Pull Requests.' }
  ];

  tooltipText: string = '';
  tooltipVisible: boolean = false;
  mouseX: number = 0;
  mouseY: number = 0;

  showTooltip(text: string, event: MouseEvent) {
    this.tooltipText = text;
    this.tooltipVisible = true;
    this.updateMousePosition(event);
  }

  hideTooltip() {
    this.tooltipVisible = false;
  }

  @HostListener('mousemove', ['$event'])
  updateMousePosition(event: MouseEvent) {
    this.mouseX = event.clientX;
    this.mouseY = event.clientY;
  }
}
