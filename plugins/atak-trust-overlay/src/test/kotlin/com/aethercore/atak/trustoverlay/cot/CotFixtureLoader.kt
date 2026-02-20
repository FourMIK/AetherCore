package com.aethercore.atak.trustoverlay.cot

import com.aethercore.atak.trustoverlay.atak.CotEventEnvelope
import javax.xml.parsers.DocumentBuilderFactory

object CotFixtureLoader {
    fun load(name: String): CotEventEnvelope {
        val path = "fixtures/cot/$name.xml"
        val stream = requireNotNull(javaClass.classLoader?.getResourceAsStream(path)) {
            "Missing fixture: $path"
        }
        stream.use {
            val document = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(it)
            val event = document.documentElement
            val point = event.getElementsByTagName("point").item(0)
            val detail = event.getElementsByTagName("detail").item(0)
            val trust = event.getElementsByTagName("trust").item(0)
            val contact = event.getElementsByTagName("contact").item(0)
            val metrics = event.getElementsByTagName("metrics").item(0)
            val sourceMeta = event.getElementsByTagName("sourceMeta").item(0)

            val detailMap = linkedMapOf(
                "detail" to "present",
                "trust_score" to trust.attributes.getNamedItem("score").nodeValue,
                "last_updated" to trust.attributes.getNamedItem("last_updated").nodeValue,
                "source" to trust.attributes.getNamedItem("source").nodeValue,
                "trust.uid" to trust.attributes.getNamedItem("uid").nodeValue,
                "callsign" to contact.attributes.getNamedItem("callsign").nodeValue,
                "integrity_packet_loss" to metrics.attributes.getNamedItem("packet_loss").nodeValue,
                "source_meta.gateway" to sourceMeta.attributes.getNamedItem("gateway").nodeValue,
                "event.source.cluster" to sourceMeta.attributes.getNamedItem("cluster").nodeValue,
            )

            return CotEventEnvelope(
                uid = event.attributes.getNamedItem("uid").nodeValue,
                type = event.attributes.getNamedItem("type").nodeValue,
                lat = point.attributes.getNamedItem("lat").nodeValue.toDoubleOrNull(),
                lon = point.attributes.getNamedItem("lon").nodeValue.toDoubleOrNull(),
                time = event.attributes.getNamedItem("time").nodeValue,
                stale = event.attributes.getNamedItem("stale").nodeValue,
                detail = detailMap,
            )
        }
    }
}
