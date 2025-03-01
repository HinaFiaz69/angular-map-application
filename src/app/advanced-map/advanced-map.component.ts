import { Component, OnInit, OnDestroy, ViewChild, ElementRef, NgZone } from "@angular/core";
import { HttpClient } from "@angular/common/http"
import * as mapboxgl from "mapbox-gl"
import { debounceTime, distinctUntilChanged, catchError, takeUntil } from "rxjs/operators"
import { Subject, fromEvent, of, timer, Subscription } from "rxjs"

interface Location {
  display_name: string
  lat: string
  lon: string
}

interface Restaurant {
  id: number
  lat: number
  lon: number
  tags: {
    name?: string
    amenity: string
  }
}

@Component({
  selector: "app-advanced-map",
  templateUrl: "./advanced-map.component.html",
  styleUrls: ["./advanced-map.component.css"],
})
export class AdvancedMapComponent implements OnInit, OnDestroy {
  @ViewChild("mapContainer") mapContainer!: ElementRef
  @ViewChild("searchInput") searchInput!: ElementRef

  private map: mapboxgl.Map | null = null
  private markers: mapboxgl.Marker[] = []
  private destroy$ = new Subject<void>()
  private refreshSubscription: Subscription | null = null

  searchQuery = "Paris"
  location: Location | null = null
  restaurants: Restaurant[] = []
  loading = false
  error: string | null = null
  isOffline = !navigator.onLine

  private readonly mapboxAccessToken =
    "pk.eyJ1IjoiYWxpLWFrYmVyLTc5IiwiYSI6ImNsYXRqMTB0bzAwY3Izdm55Zmptc2N6ZjkifQ.T28yDHgDc28SCV96kH5NUg"

  constructor(
    private http: HttpClient,
    private ngZone: NgZone,
  ) {}

  ngOnInit() {
    this.initMap()
    this.setupOfflineDetection()
    this.setupSearch()
    this.searchLocation(this.searchQuery)
  }

  ngOnDestroy() {
    this.destroy$.next()
    this.destroy$.complete()
    if (this.refreshSubscription) {
      this.refreshSubscription.unsubscribe()
    }
    if (this.map) {
      this.map.remove()
    }
  }

  private initMap() {
    this.map = new mapboxgl.Map({
      container: this.mapContainer.nativeElement,
      style: "mapbox://styles/mapbox/streets-v11",
      center: [2.3522, 48.8566],
      zoom: 13,
      accessToken: this.mapboxAccessToken,
    })

    this.map.addControl(new mapboxgl.NavigationControl())

    this.map.on("moveend", () => {
      if (!this.map) return
      const center = this.map.getCenter()
      this.fetchRestaurantsForCoordinates(center.lat, center.lng)
    })
  }

  private setupOfflineDetection() {
    fromEvent(window, "online")
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.isOffline = false
      })

    fromEvent(window, "offline")
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.isOffline = true
      })
  }

  private setupSearch() {
    fromEvent(this.searchInput.nativeElement, "input")
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => {
        this.searchLocation(this.searchQuery)
      })
  }

  searchLocation(query: string) {
    if (!query.trim() || this.isOffline) return

    this.loading = true
    this.error = null

    this.http
      .get<any[]>(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`)
      .pipe(
        catchError((error) => {
          console.error("Error fetching location:", error)
          this.error = "Failed to fetch location. Please try again."
          return of([])
        }),
      )
      .subscribe((data) => {
        if (data.length === 0) {
          this.error = "No results found for this location"
          this.location = null
        } else {
          this.location = {
            display_name: data[0].display_name,
            lat: data[0].lat,
            lon: data[0].lon,
          }
          this.updateMapCenter(Number.parseFloat(this.location.lon), Number.parseFloat(this.location.lat))
          this.fetchRestaurantsForCoordinates(
            Number.parseFloat(this.location.lat),
            Number.parseFloat(this.location.lon),
          )
        }
        this.loading = false
      })
  }

  private fetchRestaurantsForCoordinates(lat: number, lon: number) {
    if (this.isOffline) return

    this.loading = true

    const query = `[out:json];node["amenity"="restaurant"](around:1000,${lat},${lon});out body;>;out skel qt;`
    this.http
      .get<any>(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`)
      .pipe(
        catchError((error) => {
          console.error("Error fetching restaurants:", error)
          this.error = "Failed to fetch restaurants. Please try again."
          return of({ elements: [] })
        }),
      )
      .subscribe((data) => {
        this.restaurants = data.elements || []
        this.updateMapMarkers()
        this.loading = false
        this.setupAutoRefresh()
      })
  }

  private updateMapCenter(lon: number, lat: number) {
    if (this.map) {
      this.map.flyTo({
        center: [lon, lat],
        zoom: 13,
      })
    }
  }

  private updateMapMarkers() {
    if (!this.map || !this.location) return

    this.markers.forEach((marker) => marker.remove())
    this.markers = []

    const centerMarker = new mapboxgl.Marker({ color: "#FF0000" })
      .setLngLat([Number.parseFloat(this.location.lon), Number.parseFloat(this.location.lat)])
      .addTo(this.map)

    const centerPopup = new mapboxgl.Popup({ offset: 25 }).setHTML(`<h3>${this.location.display_name}</h3>`)

    centerMarker.setPopup(centerPopup)
    this.markers.push(centerMarker)

    this.restaurants.forEach((restaurant) => {
      const marker = new mapboxgl.Marker({ color: "#4285F4" })
        .setLngLat([restaurant.lon, restaurant.lat])
        .addTo(this.map!)

      const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(
        `<h3>${restaurant.tags.name || "Unnamed Restaurant"}</h3>`,
      )

      marker.setPopup(popup)

      marker.getElement().addEventListener("mouseenter", () => {
        marker.togglePopup()
      })

      marker.getElement().addEventListener("mouseleave", () => {
        marker.togglePopup()
      })

      this.markers.push(marker)
    })

    if (this.restaurants.length > 20) {
      this.setupClustering()
    }
  }

  private setupClustering() {
    if (!this.map) return

    this.map.on("load", () => {
      if (!this.map) return

      if (this.map.getSource("restaurants")) {
        ;(this.map.getSource("restaurants") as mapboxgl.GeoJSONSource).setData({
          type: "FeatureCollection",
          features: this.restaurants.map((r) => ({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [r.lon, r.lat],
            },
            properties: {
              id: r.id,
              name: r.tags.name || "Unnamed Restaurant",
            },
          })),
        })
        return
      }

      this.map.addSource("restaurants", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: this.restaurants.map((r) => ({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [r.lon, r.lat],
            },
            properties: {
              id: r.id,
              name: r.tags.name || "Unnamed Restaurant",
            },
          })),
        },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      })

      this.map.addLayer({
        id: "clusters",
        type: "circle",
        source: "restaurants",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": ["step", ["get", "point_count"], "#51bbd6", 10, "#f1f075", 30, "#f28cb1"],
          "circle-radius": ["step", ["get", "point_count"], 20, 10, 30, 30, 40],
        },
      })

      this.map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "restaurants",
        filter: ["has", "point_count"],
        layout: {
          "text-field": "{point_count_abbreviated}",
          "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
          "text-size": 12,
        },
      })
    })
  }

  private setupAutoRefresh() {
    if (this.refreshSubscription) {
      this.refreshSubscription.unsubscribe()
    }

    this.refreshSubscription = timer(30000, 30000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.location && !this.isOffline) {
          this.fetchRestaurantsForCoordinates(
            Number.parseFloat(this.location.lat),
            Number.parseFloat(this.location.lon),
          )
        }
      })
  }

  onSubmit(event: Event) {
    event.preventDefault()
    this.searchLocation(this.searchQuery)
  }
}

