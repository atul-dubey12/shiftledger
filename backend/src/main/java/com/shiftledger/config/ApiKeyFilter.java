package com.shiftledger.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

/** Single-user protection: every /api request must carry the server key, except CORS preflights and the health check. */
public class ApiKeyFilter extends OncePerRequestFilter {
    static final String HEADER = "X-Api-Key";
    private final byte[] key;

    public ApiKeyFilter(String key) { this.key = key.getBytes(StandardCharsets.UTF_8); }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return !path.startsWith("/api/") || "OPTIONS".equals(request.getMethod()) || path.equals("/api/health");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        String sent = request.getHeader(HEADER);
        if (sent != null && MessageDigest.isEqual(key, sent.getBytes(StandardCharsets.UTF_8))) {
            chain.doFilter(request, response);
            return;
        }
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write("{\"message\":\"Invalid or missing server key\"}");
    }
}
