import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScrollTriggerDirective } from '../../directives/scroll-trigger.directive';

@Component({
    selector: 'app-presentation',
    standalone: true,
    imports: [CommonModule, ScrollTriggerDirective],
    templateUrl: './presentation.component.html',
    styleUrls: ['./presentation.component.css']
})
export class PresentationComponent { }

