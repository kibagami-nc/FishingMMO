import { Directive, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';

@Directive({
    selector: '[appScrollTrigger]',
    standalone: true
})
export class ScrollTriggerDirective implements AfterViewInit, OnDestroy {
    private observer: IntersectionObserver | undefined;

    constructor(private el: ElementRef) { }

    ngAfterViewInit() {
        const options = {
            root: null,
            rootMargin: '0px',
            threshold: 0.2
        };

        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.el.nativeElement.classList.add('visible');
                } else {
                    this.el.nativeElement.classList.remove('visible');
                }
            });
        }, options);

        this.observer.observe(this.el.nativeElement);
    }

    ngOnDestroy() {
        if (this.observer) {
            this.observer.disconnect();
        }
    }
}
