import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { PortfolioSummary } from '../../models/market.models';

@Component({
  selector: 'app-portfolio',
  standalone: true,
  imports: [CommonModule, DecimalPipe],
  templateUrl: './portfolio.html',
  styleUrl: './portfolio.css'
})
export class PortfolioComponent {
  @Input({ required: true }) portfolio!: PortfolioSummary;
  @Output() stockSelected = new EventEmitter<string>();
}
