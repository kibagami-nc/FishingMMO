import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HeroComponent } from './components/hero/hero.component';
import { PresentationComponent } from './components/presentation/presentation.component';
import { SkillsComponent } from './components/skills/skills.component';
import { CertificationsComponent } from './components/certifications/certifications.component';
import { ExperienceComponent } from './components/experience/experience.component';
import { ProjectsComponent } from './components/projects/projects.component';
import { ContactComponent } from './components/contact/contact.component';
import { RadialMenuComponent } from './components/radial-menu/radial-menu.component';
import { FooterComponent } from './components/footer/footer.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, HeroComponent, PresentationComponent, SkillsComponent, CertificationsComponent, ExperienceComponent, ProjectsComponent, ContactComponent, RadialMenuComponent, FooterComponent],
  template: `
    <main class="relative z-10">
      <app-radial-menu></app-radial-menu>
      <app-hero id="hero"></app-hero>
      
      <app-presentation id="presentation"></app-presentation>
      <app-skills id="skills"></app-skills>
      <app-certifications id="certifications"></app-certifications>
      <app-experience id="experience"></app-experience>
      <app-projects id="projects"></app-projects>
      <app-contact id="contact"></app-contact>
      <app-footer></app-footer>
    </main>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class AppComponent { }
