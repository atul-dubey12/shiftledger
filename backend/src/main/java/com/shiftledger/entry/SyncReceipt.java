package com.shiftledger.entry;
import jakarta.persistence.*;
@Entity
@Table(name = "sync_receipts")
public class SyncReceipt {
    @Id @Column(length = 36) String token;
    @Column(nullable = false, columnDefinition = "text") String request;
    @Column(nullable = false, columnDefinition = "text") String response;
    protected SyncReceipt() {}
    SyncReceipt(String token, String request) { this.token = token; this.request = request; this.response = ""; }
}
