import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { AppComponent } from './app/app.component';
import { apiInterceptor } from './app/api.interceptor';

bootstrapApplication(AppComponent, { providers: [provideHttpClient(withInterceptors([apiInterceptor]))] }).catch((err) => console.error(err));
