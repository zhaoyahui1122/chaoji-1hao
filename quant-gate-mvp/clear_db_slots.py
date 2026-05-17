import sqlite3
conn = sqlite3.connect('state/quant_gate.db')
cur = conn.cursor()
cur.execute("DELETE FROM kv_store WHERE namespace='strategy' AND key='slots'")
conn.commit()
print('Deleted old strategy slots from DB (namespace=strategy, key=slots)')
conn.close()
