import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule }
from "@angular/forms";
import { TripData } from '../services/trip-data';
import { Trip } from '../models/trips';

@Component({
  selector: 'app-edit-trip',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './edit-trip.html',
  styleUrl: './edit-trip.css',
})
export class EditTrip implements OnInit {
  public editForm!: FormGroup;
  trip!: Trip;
  submitted = false;
  message: string = '';

  constructor(
    private formBuilder: FormBuilder,
    private router: Router,
    private tripData: TripData
  ) {}

  ngOnInit(): void {

    // Retrieve stashed trip code
    let tripCode = localStorage.getItem('tripCode');
    if (!tripCode) {
      alert("Something wrong, could not retrieve trip code");
      this.router.navigate(['']);
      return;
  }

  console.log('EditTrip::ngOnInit');
  console.log('tripCode: ' + tripCode);

  this.editForm = this.formBuilder.group({
    _id: [],
    code: ['', Validators.required],
    name: ['', Validators.required],
    length: ['', Validators.required],
    start: ['', Validators.required],
    resort: ['', Validators.required],
    perPerson: ['', Validators.required],
    image: ['', Validators.required],
    description: ['', Validators.required],
  });

  this.tripData.getTrip(tripCode)
    .subscribe({
      next: (value: any) => {
        this.trip = value;
        this.editForm.patchValue(value[0]);
        if (!value) {
          this.message = 'Trip not found';
        } else {
          this.message = 'Trip' + tripCode + ' retrieved';
        }
        console.log(this.message);
      },
      error: (error: any) => {
        console.log('Error: ' + error);
      }
    });
}

  public onSubmit() {
    this.submitted = true;
    if (this.editForm.valid) {
      this.tripData.updateTrip(this.editForm.value)
        .subscribe({
          next: (value: any) => {
            console.log(value);
            this.router.navigate(['']);
          },
          error: (error: any) => {
            console.log('Error: ' + error);
          }
        });
    }
  }

  get f() {
    return this.editForm.controls;
  }
}
