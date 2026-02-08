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
import { VeilleTechnoComponent } from './components/veille-techno/veille-techno.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule, HeroComponent, PresentationComponent, SkillsComponent,
    CertificationsComponent, ExperienceComponent, ProjectsComponent,
    ContactComponent, RadialMenuComponent, FooterComponent, VeilleTechnoComponent
  ],
  template: `
    <div class="app-perspective" 
         [class.modal-open]="showVeilleModal && !isClosing" 
         [class.perspective-active]="showVeilleModal || isClosing">
      <main class="main-content">
        <app-radial-menu></app-radial-menu>
        <app-hero id="hero"></app-hero>
        
        <app-presentation id="presentation" (openVeille)="showVeilleModal = true"></app-presentation>
        <app-skills id="skills"></app-skills>
        <app-certifications id="certifications"></app-certifications>
        <app-experience id="experience"></app-experience>
        <app-projects id="projects"></app-projects>
        <app-contact id="contact"></app-contact>
        <app-footer></app-footer>
      </main>
    </div>

    <!-- Veille Techno Modal -->
    <div class="veille-modal-overlay" 
         *ngIf="showVeilleModal" 
         [class.closing]="isClosing"
         (click)="closeModal()">
      <div class="veille-modal-content" (click)="$event.stopPropagation()">
          <app-veille-techno (close)="closeModal()"></app-veille-techno>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      background: #020617;
      width: 100%;
      position: relative;
    }

    .app-perspective {
      width: 100%;
      background: #020617;
      position: relative;
    }

    /* Maintain perspective during both opening and closing transitions */
    .app-perspective.perspective-active {
      perspective: 2000px;
    }

    .main-content {
      width: 100%;
      transition: transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
      transform-origin: center left;
      position: relative;
      z-index: 10;
    }

    .modal-open .main-content {
      transform: rotateY(15deg) scale(0.9) translateX(50px);
      pointer-events: none;
      user-select: none;
    }

    /* Veille Techno Modal Transitions */
    .veille-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 10000;
      display: flex;
      justify-content: flex-end;
      animation: fadeIn 0.8s ease-out; /* Matched to main transition */
      overflow: hidden;
    }

    .veille-modal-overlay.closing {
      animation: fadeOut 0.8s ease-in forwards;
    }

    .veille-modal-content {
      width: 100%;
      max-width: 1000px;
      height: 100%;
      background: #020617;
      box-shadow: -20px 0 50px rgba(0, 0, 0, 0.5);
      animation: slideInFromRight 0.8s cubic-bezier(0.16, 1, 0.3, 1);
      position: relative;
    }

    .closing .veille-modal-content {
      animation: slideOutToRight 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    @keyframes slideInFromRight {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }

    @keyframes slideOutToRight {
      from { transform: translateX(0); }
      to { transform: translateX(100%); }
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes fadeOut {
      from { opacity: 1; }
      to { opacity: 0; }
    }

    @media (max-width: 768px) {
      .veille-modal-content {
        max-width: 100%;
      }
    }
  `]
})
export class AppComponent {
  _showVeilleModal = false;
  isClosing = false;

  get showVeilleModal() { return this._showVeilleModal; }
  set showVeilleModal(value: boolean) {
    this._showVeilleModal = value;
    if (value) {
      this.isClosing = false;
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }
  }

  closeModal() {
    this.isClosing = true;
    setTimeout(() => {
      this.showVeilleModal = false;
      this.isClosing = false;
    }, 800); // Wait for transition duration
  }
}
