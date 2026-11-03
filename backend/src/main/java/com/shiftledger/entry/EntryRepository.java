package com.shiftledger.entry;

import java.time.LocalDate;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EntryRepository extends JpaRepository<Entry, Long> {
    List<Entry> findAllByOrderByDateDescIdDesc();
    List<Entry> findByDateBetweenOrderByDateDescIdDesc(LocalDate from, LocalDate to);
}
