package com.shiftledger.entry;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Older databases stored type/category as native H2 ENUM columns, which reject newly added categories.
 * ddl-auto=update never changes existing column types, so widen them to VARCHAR once at startup.
 */
@Component
class SchemaUpgrade implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(SchemaUpgrade.class);
    private final JdbcTemplate jdbc;

    SchemaUpgrade(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @Override
    public void run(ApplicationArguments args) {
        widen("CATEGORY", 30);
        widen("TYPE", 20);
    }

    private void widen(String column, int length) {
        String type = jdbc.query("SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ENTRIES' AND COLUMN_NAME = ?",
                rs -> rs.next() ? rs.getString(1) : null, column);
        if (type == null || !type.equalsIgnoreCase("ENUM")) return;
        jdbc.execute("ALTER TABLE ENTRIES ALTER COLUMN " + column + " SET DATA TYPE VARCHAR(" + length + ")");
        log.info("Converted entries.{} from ENUM to VARCHAR({})", column.toLowerCase(), length);
    }
}
