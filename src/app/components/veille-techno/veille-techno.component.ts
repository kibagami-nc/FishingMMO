import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-veille-techno',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="veille-container">
      <button class="back-btn" (click)="closeVeille()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        <span>Fermer</span>
      </button>

      <div class="bento-wrapper">
        <!-- Section Gauche: Ma Méthode -->
        <aside class="methodology-section">
          <h1 class="veille-title">Veille<br>Techno</h1>
          <p class="veille-subtitle">
            Curiosité constante et apprentissage continu pour rester à la pointe des technologies.
          </p>
          
          <div class="method-steps">
            <div class="step">
              <span class="step-num">01</span>
              <div>
                <h4>Capture</h4>
                <p>Agrégation quotidienne via Daily.dev et flux RSS.</p>
              </div>
            </div>
            <div class="step">
              <span class="step-num">02</span>
              <div>
                <h4>Filtrage</h4>
                <p>Sélection des articles fondateurs sur Medium et Dev.to.</p>
              </div>
            </div>
            <div class="step">
              <span class="step-num">03</span>
              <div>
                <h4>Pratique</h4>
                <p>POC et implémentations locales des nouvelles stack.</p>
              </div>
            </div>
          </div>
        </aside>

        <!-- Section Droite: Bento Grid -->
        <div class="bento-grid">
          <div *ngFor="let item of veilleItems; let i = index" 
               [class]="'bento-tile tile-' + i" 
               (click)="openLink(item.link)">
            <div class="tile-content">
              <div class="tile-header">
                <span class="tile-icon">{{item.icon}}</span>
                <span class="tile-category">{{item.category}}</span>
              </div>
              <h3>{{item.title}}</h3>
              <p>{{item.desc}}</p>
              <div class="tile-footer">
                <span>Visiter</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M5 12h14m-7-7l7 7-7 7"/>
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .veille-container {
      width: 100%;
      height: 100%;
      background: #020617;
      color: white;
      padding: 4rem 2rem;
      position: relative;
      overflow-y: auto;
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .back-btn {
      position: absolute;
      top: 2rem;
      right: 2rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1.5rem;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 9999px;
      color: white;
      cursor: pointer;
      z-index: 100;
      transition: all 0.3s;
    }

    .back-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.3);
    }

    .bento-wrapper {
      display: grid;
      grid-template-columns: 350px 1fr;
      gap: 4rem;
      width: 100%;
      max-width: 1300px;
      padding: 2rem;
      animation: fadeIn 0.8s ease-out;
    }

    /* Side Column */
    .methodology-section {
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }

    .veille-title {
      font-size: 5rem;
      font-weight: 900;
      line-height: 0.9;
      background: linear-gradient(135deg, #fff 0%, #6366f1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .veille-subtitle {
      font-size: 1.1rem;
      opacity: 0.6;
      line-height: 1.6;
    }

    .method-steps {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      margin-top: 2rem;
    }

    .step {
      display: flex;
      gap: 1.5rem;
      align-items: flex-start;
    }

    .step-num {
      font-family: 'Outfit', sans-serif;
      font-size: 0.8rem;
      font-weight: 800;
      color: #6366f1;
      padding-top: 0.3rem;
    }

    .step h4 { font-weight: 700; margin-bottom: 0.25rem; color: #fff; }
    .step p { font-size: 0.9rem; opacity: 0.5; }

    /* Bento Grid */
    .bento-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      grid-auto-rows: minmax(260px, auto);
      gap: 1.5rem;
    }

    .bento-tile {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 2rem;
      padding: 1.5rem;
      cursor: pointer;
      position: relative;
      overflow: hidden;
      transition: all 0.5s cubic-bezier(0.23, 1, 0.32, 1);
      display: flex;
      flex-direction: column;
    }
/* ... logic for before pseudo-element ... */
    .bento-tile::before {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(circle at var(--x, 50%) var(--y, 50%), rgba(255, 255, 255, 0.05) 0%, transparent 100%);
      opacity: 0;
      transition: opacity 0.5s;
    }

    .bento-tile:hover {
      transform: translateY(-5px);
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(255, 255, 255, 0.15);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
    }

    .bento-tile:hover::before { opacity: 1; }

    /* Tile Layouts */
    .tile-0 { grid-column: span 2; }
    .tile-1 { grid-column: span 1; grid-row: span 2; }
    .tile-2 { grid-column: span 1; }
    .tile-3 { grid-column: span 1; }

    .tile-content {
      height: 100%;
      display: flex;
      flex-direction: column;
      position: relative;
      z-index: 1;
    }

    .tile-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }

    .tile-icon { font-size: 2rem; }

    .tile-category {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #6366f1;
      background: rgba(99, 102, 241, 0.1);
      padding: 0.3rem 0.6rem;
      border-radius: 9999px;
    }

    .bento-tile h3 { font-size: 1.25rem; font-weight: 800; margin-bottom: 0.5rem; }
    .bento-tile p { font-size: 0.9rem; opacity: 0.5; line-height: 1.4; flex-grow: 1; }

    .tile-footer {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 1rem;
      font-size: 0.8rem;
      font-weight: 700;
      opacity: 0;
      transform: translateX(-10px);
      transition: all 0.3s;
    }

    .bento-tile:hover .tile-footer {
      opacity: 1;
      transform: translateX(0);
    }

    .tile-footer svg { width: 1.25rem; height: 1.25rem; transition: transform 0.3s; }
    .bento-tile:hover .tile-footer svg { transform: translateX(5px); }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Responsive */
    @media (max-width: 1100px) {
      .bento-wrapper {
        grid-template-columns: 1fr;
        gap: 3rem;
      }
      .methodology-section { text-align: center; align-items: center; }
      .veille-title { font-size: 4rem; }
    }

    @media (max-width: 768px) {
      .bento-grid {
        grid-template-columns: 1fr;
        grid-auto-rows: auto;
      }
      .tile-0, .tile-1 { grid-column: span 1; grid-row: span 1; }
      .bento-tile { min-height: 250px; }
    }
  `]
})
export class VeilleTechnoComponent {
  @Output() close = new EventEmitter<void>();

  veilleItems = [
    {
      title: 'Daily.dev',
      icon: '�',
      category: 'Agregateur',
      desc: 'Mon flux quotidien personnalisé qui rassemble les meilleurs articles tech du monde entier.',
      link: 'https://daily.dev'
    },
    {
      title: 'Medium',
      icon: '✍️',
      category: 'Articles',
      desc: 'Lecture approfondie sur les architectures complexes, le DevOps et les retours d\'expérience engineering.',
      link: 'https://medium.com'
    },
    {
      title: 'Dev.to',
      icon: '👩‍💻',
      category: 'Communauté',
      desc: 'Échanges et tutoriels pratiques partagés par la communauté sur les dernières tendances open-source.',
      link: 'https://dev.to'
    },
    {
      title: 'YouTube',
      icon: '🎥',
      category: 'Vidéo',
      desc: 'Veille dynamique via des chaînes comme Fireship ou Underscore_ pour saisir rapidement les nouveautés.',
      link: 'https://youtube.com'
    }
  ];

  closeVeille() {
    this.close.emit();
  }

  openLink(url: string) {
    window.open(url, '_blank');
  }
}
