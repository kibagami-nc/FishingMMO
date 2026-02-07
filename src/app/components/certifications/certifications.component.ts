import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScrollTriggerDirective } from '../../directives/scroll-trigger.directive';

interface Certification {
  title: string;
  issuer: string;
  date: string;
  icon: string;
  link: string;
  skills: string[];
}

@Component({
  selector: 'app-certifications',
  standalone: true,
  imports: [CommonModule, ScrollTriggerDirective],
  templateUrl: './certifications.component.html',
  styleUrls: ['./certifications.component.css']
})
export class CertificationsComponent {
  certifications: Certification[] = [];
  hoveredCert: Certification | null = null;
  overlayStyle: any = { opacity: 0 };

  constructor() {
    this.generateCertifications();
  }

  generateCertifications() {
    const baseCerts = [
      {
        title: 'Google Cloud Professional Architect',
        issuer: 'Google Cloud',
        icon: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/googlecloud/googlecloud-original.svg',
        skills: ['GCP', 'Cloud Architecture', 'Security']
      },
      {
        title: 'AWS Solutions Architect',
        issuer: 'AWS',
        icon: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/amazonwebservices/amazonwebservices-original-wordmark.svg',
        skills: ['AWS', 'High Availability', 'Networking']
      },
      {
        title: 'Terraform Associate',
        issuer: 'HashiCorp',
        icon: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/terraform/terraform-original.svg',
        skills: ['Terraform', 'IaC', 'Automation']
      },
      {
        title: 'Kubernetes Administrator (CKA)',
        issuer: 'CNCF',
        icon: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/kubernetes/kubernetes-plain.svg',
        skills: ['K8s', 'Orchestration', 'Docker']
      },
      {
        title: 'Docker Certified Associate',
        issuer: 'Docker',
        icon: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/docker/docker-original.svg',
        skills: ['Containers', 'Images', 'Registry']
      },
      {
        title: 'Azure Administrator',
        issuer: 'Microsoft',
        icon: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/azure/azure-original.svg',
        skills: ['Azure', 'Identity', 'Storage']
      }
    ];

    // Generate 9 items (3x3)
    for (let i = 0; i < 9; i++) {
      const base = baseCerts[i % baseCerts.length];
      this.certifications.push({
        title: base.title,
        issuer: base.issuer,
        date: '2024',
        icon: base.icon,
        link: '#',
        skills: base.skills
      });
    }
  }

  onCardHover(event: MouseEvent, cert: Certification) {
    const card = event.currentTarget as HTMLElement;
    this.hoveredCert = cert;
    this.overlayStyle = {
      top: `${card.offsetTop}px`,
      left: `${card.offsetLeft}px`,
      width: `${card.offsetWidth}px`,
      height: `${card.offsetHeight}px`,
      opacity: 1
    };
  }

  onGridLeave() {
    this.overlayStyle = { ...this.overlayStyle, opacity: 0 };
    // Optional: Reset hoveredCert after delay if needed, but keeping it allows fading out nicely
  }
}
