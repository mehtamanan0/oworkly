-- M8: Product Master — a 100% greenfield domain (grepped the whole repo
-- before writing this; no product/SKU/product-hierarchy table, route, or
-- seed data existed anywhere). A company-scoped, self-referencing tree
-- (Product Family -> Product -> Variant/Sub-Product), explicitly linked to
-- organisation nodes and processes via plain join tables (no implicit
-- inheritance from a parent's links -- that would be an accidental query
-- behaviour, not a configured one, per the brief's own instruction).
CREATE TABLE product (
    product_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id       UUID NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    parent_product_id UUID REFERENCES product(product_id),
    code             VARCHAR(30) NOT NULL,
    name             VARCHAR(200) NOT NULL,
    product_type     VARCHAR(20) NOT NULL DEFAULT 'PRODUCT'
        CHECK (product_type IN ('FAMILY','PRODUCT','VARIANT')),
    description      TEXT,
    sequence         SMALLINT NOT NULL DEFAULT 1,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, code)
);
CREATE INDEX ix_product_parent ON product(parent_product_id);
CREATE INDEX ix_product_company ON product(company_id);

-- Explicit product <-> organisation-node scope (which plant/vertical/dept a
-- product is made/used at). A child node does NOT automatically inherit a
-- parent node's product links -- that would have to be a separate, later,
-- explicitly-designed feature, not an accidental join.
CREATE TABLE product_org_unit_link (
    product_org_unit_link_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id       UUID NOT NULL REFERENCES product(product_id) ON DELETE CASCADE,
    org_unit_id      UUID NOT NULL REFERENCES org_unit(org_unit_id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_id, org_unit_id)
);

-- Explicit product <-> process linkage (which qualification processes are
-- relevant to producing/servicing this product).
CREATE TABLE product_process_link (
    product_process_link_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id       UUID NOT NULL REFERENCES product(product_id) ON DELETE CASCADE,
    process_id       UUID NOT NULL REFERENCES process(process_id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_id, process_id)
);
