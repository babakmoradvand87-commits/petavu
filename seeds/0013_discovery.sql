update ops.menu_item set availability='ready',planned_step=null where surface='admin' and key='search';
select seo.refresh_search_scope(null);
