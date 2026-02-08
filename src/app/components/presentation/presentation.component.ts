import { Component, AfterViewInit, OnDestroy, ElementRef, ViewChild, Output, EventEmitter } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Inject, PLATFORM_ID } from '@angular/core';
import { ScrollTriggerDirective } from '../../directives/scroll-trigger.directive';

@Component({
    selector: 'app-presentation',
    standalone: true,
    imports: [CommonModule, ScrollTriggerDirective],
    templateUrl: './presentation.component.html',
    styleUrls: ['./presentation.component.css']
})
export class PresentationComponent implements AfterViewInit, OnDestroy {
    @ViewChild('videoWrapper') videoWrapper!: ElementRef;
    @Output() openVeille = new EventEmitter<void>();
    isPip = false;

    private observer: IntersectionObserver | null = null;

    constructor(@Inject(PLATFORM_ID) private platformId: Object) { }

    ngAfterViewInit() {
        if (isPlatformBrowser(this.platformId)) {
            const options = {
                root: null,
                threshold: 0
            };

            this.observer = new IntersectionObserver(([entry]) => {
                // When the wrapper is NOT intersecting (out of view), enable PIP
                this.isPip = !entry.isIntersecting && entry.boundingClientRect.top < 0;
            }, options);

            if (this.videoWrapper) {
                this.observer.observe(this.videoWrapper.nativeElement);
            }
        }
    }

    ngOnDestroy() {
        if (this.observer) {
            this.observer.disconnect();
        }
    }
}

