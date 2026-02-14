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
import { MobileNavComponent } from './components/mobile-nav/mobile-nav.component';
import { AppsOnlineComponent } from './components/apps-online/apps-online.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule, HeroComponent, PresentationComponent, SkillsComponent,
    CertificationsComponent, ExperienceComponent, ProjectsComponent,
    ContactComponent, RadialMenuComponent, FooterComponent, VeilleTechnoComponent,
    MobileNavComponent, AppsOnlineComponent
  ],
  template: `
    <div class="app-perspective" 
         [class.apps-open]="showAppsModal && !isAppsClosing"
         [class.veille-open]="showVeilleModal && !isClosing"
         [class.perspective-active]="showVeilleModal || isClosing || showAppsModal || isAppsClosing">
      <main class="main-content">
        <app-mobile-nav></app-mobile-nav>
        <app-radial-menu></app-radial-menu>
        <app-hero id="hero" (openApps)="showAppsModal = true"></app-hero>
        
        <app-presentation id="presentation" 
            (openVeille)="showVeilleModal = true">
        </app-presentation>
        <app-skills id="skills"></app-skills>
        <app-certifications id="certifications"></app-certifications>
        <app-experience id="experience"></app-experience>
        <app-projects id="projects"></app-projects>
        <app-contact id="contact"></app-contact>
        <app-footer></app-footer>
      </main>
    </div>

    <!-- Veille Techno Modal (Right Side) -->
    <div class="veille-modal-overlay right-side" 
         *ngIf="showVeilleModal" 
         [class.closing]="isClosing"
         (click)="closeModal('veille')">
      <div class="veille-modal-content" (click)="$event.stopPropagation()">
          <app-veille-techno (close)="closeModal('veille')"></app-veille-techno>
      </div>
    </div>

    <!-- Mes Apps Modal (Left Side) -->
    <div class="veille-modal-overlay left-side" 
         *ngIf="showAppsModal" 
         [class.closing]="isAppsClosing"
         (click)="closeModal('apps')">
      <div class="veille-modal-content" (click)="$event.stopPropagation()">
          <app-apps-online (close)="closeModal('apps')"></app-apps-online>
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

    .app-perspective.perspective-active {
      perspective: 2000px;
    }

    .main-content {
      width: 100%;
      transition: transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
      transform-origin: center;
      position: relative;
      z-index: 10;
    }

    /* Apps Open (Left Modal) -> Swapped Animation */
    .apps-open .main-content {
      transform: rotateY(-15deg) scale(0.9) translateX(-50px);
      pointer-events: none;
      user-select: none;
    }

    /* Veille Open (Right Modal) -> Swapped Animation */
    .veille-open .main-content {
      transform: rotateY(15deg) scale(0.9) translateX(50px);
      pointer-events: none;
      user-select: none;
    }

    /* Modal Overlay Base */
    .veille-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 10000;
      display: flex;
      animation: fadeIn 0.8s ease-out;
      overflow: hidden;
    }

    .veille-modal-overlay.right-side { justify-content: flex-end; }
    .veille-modal-overlay.left-side { justify-content: flex-start; }

    .veille-modal-overlay.closing {
      animation: fadeOut 0.8s ease-in forwards;
    }

    .veille-modal-content {
      width: 100%;
      max-width: 1000px;
      height: 100%;
      background: #020617;
      box-shadow: 0 0 50px rgba(0, 0, 0, 0.5);
      position: relative;
    }

    .right-side .veille-modal-content {
      animation: slideInFromRight 0.8s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: -20px 0 50px rgba(0, 0, 0, 0.5);
    }

    .left-side .veille-modal-content {
      animation: slideInFromLeft 0.8s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 20px 0 50px rgba(0, 0, 0, 0.5);
    }

    .right-side.closing .veille-modal-content {
      animation: slideOutToRight 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    .left-side.closing .veille-modal-content {
      animation: slideOutToLeft 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    @keyframes slideInFromRight {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }

    @keyframes slideOutToRight {
      from { transform: translateX(0); }
      to { transform: translateX(100%); }
    }

    @keyframes slideInFromLeft {
      from { transform: translateX(-100%); }
      to { transform: translateX(0); }
    }

    @keyframes slideOutToLeft {
      from { transform: translateX(0); }
      to { transform: translateX(-100%); }
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
  _showAppsModal = false;
  isClosing = false;
  isAppsClosing = false;

  get showVeilleModal() { return this._showVeilleModal; }
  set showVeilleModal(value: boolean) {
    this._showVeilleModal = value;
    this.handleBodyScroll(value);
  }

  get showAppsModal() { return this._showAppsModal; }
  set showAppsModal(value: boolean) {
    this._showAppsModal = value;
    this.handleBodyScroll(value);
  }

  private handleBodyScroll(isOpen: boolean) {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }
  }

  closeModal(type: 'veille' | 'apps') {
    if (type === 'veille') {
      this.isClosing = true;
      setTimeout(() => {
        this.showVeilleModal = false;
        this.isClosing = false;
        this.handleBodyScroll(false);
      }, 800);
    } else {
      this.isAppsClosing = true;
      setTimeout(() => {
        this.showAppsModal = false;
        this.isAppsClosing = false;
        this.handleBodyScroll(false);
      }, 800);
    }
  }
}

