import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './login.html',
  styleUrl: './login.css'
})
export class LoginComponent {
  isSubmitting = false;

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router
  ) {}

  onLoginClick(): void {
    if (this.isSubmitting) {
      return;
    }

    this.isSubmitting = true;

    this.authService.login().subscribe({
      next: () => {
        this.isSubmitting = false;
        this.router.navigateByUrl('/dashboard');
      },
      error: (error: unknown) => {
        this.isSubmitting = false;
        console.error('Fresh token generation failed before dashboard redirect:', error);
        this.router.navigateByUrl('/dashboard');
      }
    });
  }
}
