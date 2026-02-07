import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-contact',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './contact.component.html',
    styleUrl: './contact.component.css'
})
export class ContactComponent {
    contactData = {
        name: '',
        email: '',
        message: ''
    };

    submitted = false;

    onSubmit() {
        console.log('Form submitted:', this.contactData);
        this.submitted = true;

        // Reset form after delay
        setTimeout(() => {
            this.submitted = false;
            this.contactData = { name: '', email: '', message: '' };
        }, 3000);
    }
}
