package com.shiftledger.entry;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import java.util.UUID;
import org.springframework.http.*;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** Receipts survive deletion of entries, so a late retry cannot resurrect a deleted entry. */
@RestController
@RequestMapping("/api/entries/queued")
public class QueuedEntryController {
    private final EntityManager em;
    private final TransactionTemplate transactions;
    private final EntryController entries;
    private final ObjectMapper json;
    public QueuedEntryController(EntityManager em, TransactionTemplate transactions, EntryController entries, ObjectMapper json) {
        this.em = em; this.transactions = transactions; this.entries = entries; this.json = json;
    }
    @PutMapping(value = "/{token}", produces = MediaType.APPLICATION_JSON_VALUE)
    public String create(@PathVariable UUID token, @RequestBody EntryRequest request) throws Exception {
        String payload = json.writeValueAsString(request);
        String id = token.toString();
        try {
            return transactions.execute(status -> {
                SyncReceipt existing = em.find(SyncReceipt.class, id);
                if (existing != null) return replay(existing, payload);
                SyncReceipt receipt = new SyncReceipt(id, payload);
                em.persist(receipt);
                em.flush(); // Unique token serializes concurrent retries before creating any entry.
                Entry saved = entries.create(request);
                try { receipt.response = json.writeValueAsString(saved); }
                catch (Exception e) { throw new IllegalStateException(e); }
                return receipt.response;
            });
        } catch (RuntimeException failure) {
            // A competing transaction may have committed this token while our insert waited.
            SyncReceipt existing = em.find(SyncReceipt.class, id);
            if (existing != null) return replay(existing, payload);
            throw failure;
        }
    }
    private String replay(SyncReceipt receipt, String payload) {
        if (!receipt.request.equals(payload)) throw new ResponseStatusException(HttpStatus.CONFLICT, "This sync token already belongs to a different entry.");
        return receipt.response;
    }
}
