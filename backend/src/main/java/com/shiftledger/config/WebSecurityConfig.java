package com.shiftledger.config;

import java.util.Arrays;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

/**
 * CORS runs as the first servlet filter so that every response, including the API-key filter's 401,
 * carries CORS headers; otherwise the browser would hide the 401 behind a generic network error.
 */
@Configuration
public class WebSecurityConfig {
    private static final int MIN_KEY_LENGTH = 32;

    @Bean
    FilterRegistrationBean<CorsFilter> corsFilter(@Value("${app.allowed-origins}") String origins) {
        CorsConfiguration cors = new CorsConfiguration();
        cors.setAllowedOrigins(Arrays.stream(origins.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList());
        cors.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        cors.setAllowedHeaders(List.of("Content-Type", ApiKeyFilter.HEADER));
        cors.setExposedHeaders(List.of("Content-Disposition"));
        cors.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", cors);
        FilterRegistrationBean<CorsFilter> bean = new FilterRegistrationBean<>(new CorsFilter(source));
        bean.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return bean;
    }

    @Bean
    FilterRegistrationBean<ApiKeyFilter> apiKeyFilter(@Value("${app.api-key:}") String key,
                                                      @Value("${app.require-api-key:false}") boolean required) {
        if (required && key.length() < MIN_KEY_LENGTH) {
            throw new IllegalStateException("API_KEY must be set to at least " + MIN_KEY_LENGTH + " characters (generate one with: openssl rand -hex 32).");
        }
        FilterRegistrationBean<ApiKeyFilter> bean = new FilterRegistrationBean<>(new ApiKeyFilter(key));
        bean.addUrlPatterns("/api/*");
        bean.setOrder(Ordered.HIGHEST_PRECEDENCE + 1);
        // Local dev runs without a key; the filter only exists when one is configured.
        bean.setEnabled(!key.isEmpty());
        return bean;
    }
}
