package com.shiftledger.entry;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/entries")
public class EntryController {
    private static final BigDecimal MAX_HOURS = BigDecimal.valueOf(24);
    private final EntryRepository repository;

    public EntryController(EntryRepository repository) { this.repository = repository; }

    @GetMapping
    public List<Entry> all(@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                           @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        if (from == null && to == null) return repository.findAllByOrderByDateDescIdDesc();
        return repository.findByDateBetweenOrderByDateDescIdDesc(from == null ? LocalDate.of(2000, 1, 1) : from,
                to == null ? LocalDate.of(2999, 12, 31) : to);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Entry create(@RequestBody EntryRequest request) {
        validate(request);
        return repository.save(new Entry(request, clean(request.note())));
    }

    @PutMapping("/{id}")
    public Entry update(@PathVariable Long id, @RequestBody EntryRequest request) {
        validate(request);
        Entry entry = repository.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        entry.apply(request, clean(request.note()));
        return repository.save(entry);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        if (!repository.existsById(id)) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        repository.deleteById(id);
    }

    @PostMapping("/import")
    @Transactional
    public ImportResponse importEntries(@RequestBody ImportRequest request) {
        List<EntryRequest> incoming = request.entries() == null ? List.of() : request.entries();
        List<ImportError> errors = new ArrayList<>();
        List<EntryRequest> valid = new ArrayList<>();
        for (int i = 0; i < incoming.size(); i++) {
            String message = validationMessage(incoming.get(i));
            if (message != null) errors.add(new ImportError(i + 1, message));
            else valid.add(incoming.get(i));
        }
        Map<String, Integer> counts = new HashMap<>();
        for (Entry existing : repository.findAll()) counts.merge(duplicateKey(existing), 1, Integer::sum);
        List<EntryRequest> fresh = new ArrayList<>();
        int duplicates = 0;
        for (EntryRequest row : valid) {
            String key = duplicateKey(row);
            int left = counts.getOrDefault(key, 0);
            if (left > 0) {
                counts.put(key, left - 1);
                duplicates++;
            } else fresh.add(row);
        }
        if (!request.dryRun()) {
            for (EntryRequest row : fresh) repository.save(new Entry(row, clean(row.note())));
        }
        return new ImportResponse(fresh.size(), duplicates, errors);
    }

    @GetMapping(value = "/export", produces = "text/csv")
    public ResponseEntity<String> export(@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                         @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        StringBuilder csv = new StringBuilder("Date,Type,Category,Amount,Orders,Hours,Km,Note,COD,PaidFrom,SettlementMethod\n");
        for (Entry e : all(from, to)) {
            csv.append(e.getDate()).append(',').append(e.getType()).append(',')
                    .append(e.getCategory() == null ? "" : e.getCategory()).append(',')
                    .append(e.getAmount().toPlainString()).append(',')
                    .append(e.getOrderCount() == null ? "" : e.getOrderCount()).append(',')
                    .append(e.getHoursWorked() == null ? "" : e.getHoursWorked().toPlainString()).append(',')
                    .append(e.getDistanceKm() == null ? "" : e.getDistanceKm().toPlainString()).append(',')
                    .append(csvCell(e.getNote())).append(',')
                    .append(e.getCodAmount() == null ? "" : e.getCodAmount().toPlainString()).append(',')
                    .append(e.getPaidFrom() == null ? "" : e.getPaidFrom()).append(',')
                    .append(e.getSettlementMethod() == null ? "" : e.getSettlementMethod()).append('\n');
        }
        String filename = (from == null && to == null)
                ? "shiftledger-all-" + LocalDate.now() + ".csv"
                : "shiftledger-" + LocalDate.now() + ".csv";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(MediaType.parseMediaType("text/csv; charset=UTF-8"))
                .body(csv.toString());
    }

    private void validate(EntryRequest request) {
        String message = validationMessage(request);
        if (message != null) throw badRequest(message);
    }

    private String validationMessage(EntryRequest request) {
        if (request == null || request.type() == null || request.amount() == null || request.date() == null) return "Type, amount, and date are required.";
        // A COD order whose payout isn't known yet, or an end-of-shift entry that only records hours, may carry ₹0.
        boolean zeroAllowed = request.type() == EntryType.INCOME && (positive(request.codAmount()) || positive(request.hoursWorked()));
        if (request.amount().signum() < 0 || (request.amount().signum() == 0 && !zeroAllowed)) return "Enter an amount greater than ₹0.";
        if (request.amount().compareTo(BigDecimal.valueOf(10_000_000)) >= 0) return "Amount is too large.";
        if (request.date().isAfter(LocalDate.now().plusDays(1))) return "Date cannot be in the future.";
        boolean hasShiftDetails = request.orderCount() != null || request.hoursWorked() != null || request.distanceKm() != null;
        switch (request.type()) {
            case INCOME -> {
                if (request.category() != null) return "Income entries do not have an expense category.";
                if (request.paidFrom() != null) return "Only expenses can be paid from COD cash.";
            }
            case EXPENSE -> {
                if (request.category() == null) return "Choose an expense category.";
                if (hasShiftDetails) return "Orders, hours and distance belong on shift earnings.";
                if (request.codAmount() != null) return "COD cash is recorded on orders, not expenses.";
            }
            case COD_SETTLEMENT -> {
                if (request.settlementMethod() == null) return "Choose how the COD cash was settled.";
                if (request.category() != null || hasShiftDetails || request.codAmount() != null || request.paidFrom() != null) {
                    return "A COD settlement only has an amount, date, method and note.";
                }
            }
        }
        if (request.type() != EntryType.COD_SETTLEMENT && request.settlementMethod() != null) return "Settlement method only applies to COD settlements.";
        if (request.codAmount() != null && (request.codAmount().signum() < 0 || request.codAmount().compareTo(BigDecimal.valueOf(100_000)) >= 0)) {
            return "COD cash must be between ₹0 and ₹1,00,000.";
        }
        if (request.orderCount() != null && (request.orderCount() < 0 || request.orderCount() > 500)) return "Orders must be between 0 and 500.";
        if (request.hoursWorked() != null && (request.hoursWorked().signum() < 0 || request.hoursWorked().compareTo(MAX_HOURS) > 0)) {
            return "Hours must be between 0 and 24.";
        }
        if (request.distanceKm() != null && (request.distanceKm().signum() < 0 || request.distanceKm().compareTo(BigDecimal.valueOf(2000)) > 0)) {
            return "Distance must be between 0 and 2000 km.";
        }
        return null;
    }

    /** Same fields, in the same order, as duplicateKey in csv.ts. Amounts drop trailing zeros so 40 and 40.00 match. */
    private String duplicateKey(Entry entry) {
        return duplicateKey(entry.getDate(), entry.getType(), entry.getCategory(), entry.getAmount(), entry.getOrderCount(),
                entry.getHoursWorked(), entry.getDistanceKm(), entry.getNote(), entry.getCodAmount(), entry.getPaidFrom(), entry.getSettlementMethod());
    }

    private String duplicateKey(EntryRequest request) {
        return duplicateKey(request.date(), request.type(), request.category(), request.amount(), request.orderCount(),
                request.hoursWorked(), request.distanceKm(), clean(request.note()), request.codAmount(), request.paidFrom(), request.settlementMethod());
    }

    private static String duplicateKey(LocalDate date, EntryType type, ExpenseCategory category, BigDecimal amount, Integer orderCount,
                                       BigDecimal hoursWorked, BigDecimal distanceKm, String note, BigDecimal codAmount, PaidFrom paidFrom,
                                       SettlementMethod settlementMethod) {
        return String.join("\u001f",
                date == null ? "" : date.toString(),
                type == null ? "" : type.name(),
                category == null ? "" : category.name(),
                plain(amount),
                orderCount == null ? "" : orderCount.toString(),
                plain(hoursWorked),
                plain(distanceKm),
                note == null ? "" : note,
                plain(codAmount),
                paidFrom == null ? "" : paidFrom.name(),
                settlementMethod == null ? "" : settlementMethod.name());
    }

    private static String plain(BigDecimal value) {
        return value == null ? "" : value.stripTrailingZeros().toPlainString();
    }

    private static boolean positive(BigDecimal value) { return value != null && value.signum() > 0; }

    private static ResponseStatusException badRequest(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }

    private static String csvCell(String value) {
        if (value == null) return "";
        String safe = value.matches("^[=+\\-@].*") ? "'" + value : value;
        return "\"" + safe.replace("\"", "\"\"") + "\"";
    }

    private String clean(String note) {
        if (note == null || note.isBlank()) return null;
        return note.trim().substring(0, Math.min(note.trim().length(), 180));
    }

    public record ImportRequest(List<EntryRequest> entries, boolean dryRun) {}
    public record ImportError(int row, String message) {}
    public record ImportResponse(int imported, int duplicates, List<ImportError> errors) {}
}
