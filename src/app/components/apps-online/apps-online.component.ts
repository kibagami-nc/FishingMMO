import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'app-apps-online',
    standalone: true,
    imports: [CommonModule],
    template: `
    <div class="apps-container">
      <button class="back-btn" (click)="closeApps()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
        <span>Fermer</span>
      </button>

      <div class="bento-wrapper">
        <aside class="intro-section">
          <h1 class="apps-title">Online<br>Apps</h1>
          <p class="apps-subtitle">
            Une sélection de mes réalisations actuellement déployées et accessibles en ligne.
          </p>
          
          <div class="stats-box">
            <div class="stat">
              <span class="stat-value">Active</span>
              <p>Applications en production</p>
            </div>
            <div class="stat">
              <span class="stat-value">24/7</span>
              <p>Disponibilité haute performance</p>
            </div>
          </div>
        </aside>

        <div class="bento-grid">
          <div *ngFor="let item of appItems; let i = index" 
               [class]="'bento-tile tile-' + i" 
               (click)="openLink(item.link)">
            <div class="tile-content">
              <div class="tile-header">
                <span class="tile-icon">{{item.icon}}</span>
                <span class="tile-status" [class.online]="item.isOnline">Online</span>
              </div>
              <h3>{{item.title}}</h3>
              <p>{{item.desc}}</p>
              <div class="tile-footer">
                <span>Accéder à l'app</span>
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
    .apps-container {
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
      left: 2rem;
      display: flex;
      flex-direction: row-reverse;
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

    .intro-section {
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }

    .apps-title {
      font-size: 5rem;
      font-weight: 900;
      line-height: 0.9;
      background: linear-gradient(135deg, #fff 0%, #ec4899 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .apps-subtitle {
      font-size: 1.1rem;
      opacity: 0.6;
      line-height: 1.6;
    }

    .stats-box {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      margin-top: 2rem;
    }

    .stat-value {
      font-family: 'Outfit', sans-serif;
      font-size: 1.2rem;
      font-weight: 800;
      color: #ec4899;
    }

    .stat p { font-size: 0.9rem; opacity: 0.5; }

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

    .bento-tile:hover {
      transform: translateY(-5px);
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(255, 255, 255, 0.15);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
    }

    .tile-0 { grid-column: span 1; grid-row: span 2; }
    .tile-1 { grid-column: span 1; }
    .tile-2 { grid-column: span 1; }

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

    .tile-status {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #10b981;
      background: rgba(16, 185, 129, 0.1);
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

    .bento-tile:hover .tile-footer { opacity: 1; transform: translateX(0); }
    .tile-footer svg { width: 1.25rem; height: 1.25rem; transition: transform 0.3s; }
    .bento-tile:hover .tile-footer svg { transform: translateX(5px); }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 1100px) {
      .bento-wrapper { grid-template-columns: 1fr; gap: 3rem; }
      .intro-section { text-align: center; align-items: center; }
      .apps-title { font-size: 4rem; }
    }

    @media (max-width: 768px) {
      .bento-grid { grid-template-columns: 1fr; }
      .tile-0, .tile-1 { grid-column: span 1; grid-row: span 1; }
    }
  `]
})
export class AppsOnlineComponent {
    @Output() close = new EventEmitter<void>();

    appItems = [
        {
            title: 'Portfolio V3',
            icon: '💎',
            isOnline: true,
            desc: 'Cette application même ! Un portfolio ultra-premium avec animations avancées et intégration YouTube.',
            link: 'https://kibagami.nc'
        },
        {
            title: 'BienMeLoger',
            icon: '🏠',
            isOnline: true,
            desc: 'Plateforme immobilière de référence en Nouvelle-Calédonie, optimisée pour la recherche et l\'expérience utilisateur.',
            link: 'https://bienmeloger.nc'
        },
        {
            title: 'Argus.nc',
            icon: '🚗',
            isOnline: true,
            desc: 'Application de cotation automobile permettant d\'évaluer précisément la valeur des véhicules sur le marché local.',
            link: 'https://argus.nc'
        }
    ];

    closeApps() {
        this.close.emit();
    }

    openLink(url: string) {
        window.open(url, '_blank');
    }
}
