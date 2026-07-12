import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonButton,
  IonIcon,
  IonContent,
  IonCard,
  IonCardContent,
  IonBadge,
  IonList,
  IonItem,
  IonLabel,
  IonSkeletonText,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { locationOutline, createOutline, pricetagOutline } from 'ionicons/icons';
import { ItemService } from '../../../core/services/item.service';
import { Item } from '../../../core/models/item.model';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-item-detail',
  standalone: true,
  templateUrl: './item-detail.page.html',
  styleUrls: ['./item-detail.page.scss'],
  imports: [
    CommonModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonIcon,
    IonContent,
    IonCard,
    IonCardContent,
    IonBadge,
    IonList,
    IonItem,
    IonLabel,
    IonSkeletonText,
  ],
})
export class ItemDetailPage implements OnInit {
  item: Item | null = null;
  loading = true;
  lowStockThreshold = environment.lowStockThreshold;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private itemService: ItemService,
  ) {
    addIcons({ locationOutline, createOutline, pricetagOutline });
  }

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.item = (await this.itemService.getById(id)) ?? null;
    }
    this.loading = false;
  }

  edit(): void {
    if (this.item) {
      this.router.navigateByUrl(`/items/${this.item.id}/edit`);
    }
  }
}
