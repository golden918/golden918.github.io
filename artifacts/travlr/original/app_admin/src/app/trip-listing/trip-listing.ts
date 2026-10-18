import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TripCard } from '../trip-card/trip-card';

import { TripData } from '../services/trip-data';
import { Trip } from '../models/trips';

import { Router } from '@angular/router';

@Component({
  selector: 'app-trip-listing',
  standalone: true,
  imports: [CommonModule, TripCard],
  templateUrl: './trip-listing.html',
  styleUrl: './trip-listing.css',
})

export class TripListing implements OnInit {

  trips: Trip[] = [];
  message: string = '';

  constructor(
    private tripData: TripData,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {
    console.log('TripListing.constructor');
  }

  public addTrip(): void {
    this.router.navigate(['/add-trip']);
  }

  private getStuff(): void {
    this.tripData.getTrips()
      .subscribe({
        next: (value: any) => {
          this.trips = value;
          this.cdr.detectChanges();
          console.log('Trips set to:', this.trips.length);
        },
        error: (error: any) => {
          console.log('Error: ' + error);
        }
      });
  }

  ngOnInit(): void {
    console.log('ngOnInit');
    this.getStuff();
  }
}
