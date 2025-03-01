import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AdvancedMapComponent } from './advanced-map.component';

describe('AdvancedMapComponent', () => {
  let component: AdvancedMapComponent;
  let fixture: ComponentFixture<AdvancedMapComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ AdvancedMapComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AdvancedMapComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
