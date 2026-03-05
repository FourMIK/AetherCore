package com.aethercore.atak.trustoverlay

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.ImageButton
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.aethercore.atak.trustoverlay.core.RalphieNodeDaemon
import com.aethercore.atak.trustoverlay.identity.DeviceIdentityManager
import com.aethercore.atak.trustoverlay.network.C2SocketClient
import com.aethercore.atak.trustoverlay.network.GatewayClient
import com.aethercore.atak.trustoverlay.network.NodeSummary
import com.aethercore.atak.trustoverlay.ui.NodeAdapter
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.osmdroid.config.Configuration
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class AtakAetherCoreActivity : AppCompatActivity() {
    private lateinit var mapView: MapView
    private lateinit var gatewayStatusText: TextView
    private lateinit var identityStatusText: TextView
    private lateinit var c2StatusText: TextView
    private lateinit var nodeCountText: TextView
    private lateinit var telemetryStatusText: TextView
    private lateinit var lastSyncText: TextView
    private lateinit var alertsText: TextView
    private lateinit var timeText: TextView
    private lateinit var nodeAdapter: NodeAdapter

    private val handler = Handler(Looper.getMainLooper())
    private val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.US)
    private val markers = mutableMapOf<String, Marker>()
    private var pollJob: Job? = null
    private var daemon: RalphieNodeDaemon? = null
    private var c2Client: C2SocketClient? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_atak_aethercore)

        mapView = findViewById(R.id.mapView)
        gatewayStatusText = findViewById(R.id.gatewayStatusText)
        identityStatusText = findViewById(R.id.identityStatusText)
        c2StatusText = findViewById(R.id.c2StatusText)
        nodeCountText = findViewById(R.id.nodeCountText)
        telemetryStatusText = findViewById(R.id.telemetryStatusText)
        lastSyncText = findViewById(R.id.lastSyncText)
        alertsText = findViewById(R.id.alertsText)
        timeText = findViewById(R.id.timeText)

        Configuration.getInstance().userAgentValue = applicationContext.packageName
        mapView.setMultiTouchControls(true)
        mapView.controller.setZoom(13.0)

        setupRecycler()
        setupButtons()
        startTelemetryService()
        initializeIdentity()
        initializeDaemon()
        startC2Link()
        requestLocationPermissions()
        startTimeTicker()
        startNodePolling()
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacksAndMessages(null)
        pollJob?.cancel()
        c2Client?.disconnect()
        mapView.onDetach()
    }

    override fun onResume() {
        super.onResume()
        mapView.onResume()
    }

    override fun onPause() {
        super.onPause()
        mapView.onPause()
    }

    private fun setupRecycler() {
        val recycler = findViewById<androidx.recyclerview.widget.RecyclerView>(R.id.nodesRecycler)
        nodeAdapter = NodeAdapter()
        recycler.layoutManager = LinearLayoutManager(this)
        recycler.adapter = nodeAdapter
    }

    private fun setupButtons() {
        findViewById<ImageButton>(R.id.btnLocate).setOnClickListener {
            val self = mapView.mapCenter
            mapView.controller.animateTo(self)
        }
        findViewById<ImageButton>(R.id.btnSweep).setOnClickListener {
            triggerAethericSweep()
        }
        findViewById<ImageButton>(R.id.btnSettings).setOnClickListener {
            showGatewayDialog()
        }
    }

    private fun startTelemetryService() {
        startService(Intent(this, TelemetryService::class.java))
        telemetryStatusText.text = "Telemetry: ACTIVE"
        telemetryStatusText.setTextColor(ContextCompat.getColor(this, R.color.atak_status_ok))
    }

    private fun initializeIdentity() {
        val identityManager = DeviceIdentityManager(this)
        val fingerprint = runCatching { identityManager.hardwareFingerprint() }
            .getOrElse { "UNAVAILABLE" }
        identityStatusText.text = "Identity: ${fingerprint.take(28)}"
    }

    private fun initializeDaemon() {
        val daemon = RalphieNodeDaemon(this)
        val started = runCatching { daemon.start() }.getOrDefault(false)
        this.daemon = daemon
        if (started) {
            c2StatusText.text = "C2 Link: STANDBY"
            c2StatusText.setTextColor(ContextCompat.getColor(this, R.color.atak_status_ok))
        } else {
            c2StatusText.text = "C2 Link: OFFLINE"
            c2StatusText.setTextColor(ContextCompat.getColor(this, R.color.atak_status_critical))
            alertsText.text = "Alerts: JNI daemon unavailable"
        }
    }

    private fun startC2Link() {
        val identity = DeviceIdentityManager(this)
        val wsUrl = GatewayConfig.resolveGatewayWebSocketUrl(this)
        val client = C2SocketClient(
            identityManager = identity,
            scope = lifecycleScope,
            onStatus = { status ->
                when (status) {
                    is C2SocketClient.C2Status.Connecting -> {
                        c2StatusText.text = "C2 Link: CONNECTING"
                        c2StatusText.setTextColor(ContextCompat.getColor(this, R.color.atak_status_warn))
                    }
                    is C2SocketClient.C2Status.Connected -> {
                        c2StatusText.text = "C2 Link: CONNECTED"
                        c2StatusText.setTextColor(ContextCompat.getColor(this, R.color.atak_status_ok))
                    }
                    is C2SocketClient.C2Status.Disconnected -> {
                        c2StatusText.text = "C2 Link: DISCONNECTED"
                        c2StatusText.setTextColor(ContextCompat.getColor(this, R.color.atak_status_critical))
                    }
                    is C2SocketClient.C2Status.Error -> {
                        c2StatusText.text = "C2 Link: ERROR"
                        c2StatusText.setTextColor(ContextCompat.getColor(this, R.color.atak_status_critical))
                        alertsText.text = "Alerts: ${status.reason}"
                    }
                }
            },
            onInbound = { message ->
                val type = message.optString("type", "MESSAGE")
                alertsText.text = "Alerts: inbound $type"
            }
        )
        c2Client = client
        client.connect(wsUrl)
    }

    private fun triggerAethericSweep() {
        val daemon = daemon
        if (daemon == null) {
            alertsText.text = "Alerts: Sweep blocked (daemon missing)"
            return
        }
        val ok = runCatching { daemon.forceSweep() }.getOrDefault(false)
        if (ok) {
            alertsText.text = "Alerts: Aetheric Sweep triggered"
        } else {
            alertsText.text = "Alerts: Sweep failed"
        }
    }

    private fun requestLocationPermissions() {
        val fineGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarseGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!fineGranted && !coarseGranted) {
            requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), LOCATION_REQUEST_CODE)
        }
    }

    private fun startTimeTicker() {
        handler.post(object : Runnable {
            override fun run() {
                timeText.text = timeFormat.format(Date())
                handler.postDelayed(this, 1000)
            }
        })
    }

    private fun startNodePolling() {
        pollJob?.cancel()
        pollJob = lifecycleScope.launch {
            while (isActive) {
                val gatewayUrl = GatewayConfig.resolveGatewayBaseUrl(this@AtakAetherCoreActivity)
                val client = GatewayClient(gatewayUrl)
                try {
                    val nodes = client.fetchNodes()
                    updateNodes(nodes)
                    gatewayStatusText.text = "Gateway: ONLINE"
                    gatewayStatusText.setTextColor(ContextCompat.getColor(this@AtakAetherCoreActivity, R.color.atak_status_ok))
                    lastSyncText.text = "Sync: ${timeFormat.format(Date())}"
                } catch (error: Exception) {
                    Log.e(TAG, "Failed to fetch nodes", error)
                    gatewayStatusText.text = "Gateway: OFFLINE"
                    gatewayStatusText.setTextColor(ContextCompat.getColor(this@AtakAetherCoreActivity, R.color.atak_status_critical))
                    alertsText.text = "Alerts: Gateway unreachable"
                }
                delay(POLL_INTERVAL_MS)
            }
        }
    }

    private fun updateNodes(nodes: List<NodeSummary>) {
        nodeAdapter.submitList(nodes)
        nodeCountText.text = "Nodes: ${nodes.size}"
        updateMarkers(nodes)
    }

    private fun updateMarkers(nodes: List<NodeSummary>) {
        val seen = nodes.map { it.nodeId }.toSet()
        val iterator = markers.entries.iterator()
        while (iterator.hasNext()) {
            val entry = iterator.next()
            if (!seen.contains(entry.key)) {
                mapView.overlays.remove(entry.value)
                iterator.remove()
            }
        }

        for (node in nodes) {
            val lat = node.latitude ?: continue
            val lon = node.longitude ?: continue
            val position = GeoPoint(lat, lon)
            val marker = markers[node.nodeId] ?: Marker(mapView).also { created ->
                created.title = node.nodeId
                created.setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
                mapView.overlays.add(created)
                markers[node.nodeId] = created
            }
            marker.position = position
            marker.icon = ContextCompat.getDrawable(
                this,
                when {
                    node.trustScore >= 85 -> R.drawable.trust_marker_green
                    node.trustScore >= 60 -> R.drawable.trust_marker_amber
                    else -> R.drawable.trust_marker_red
                }
            )
        }

        if (nodes.isNotEmpty()) {
            val first = nodes.firstOrNull { it.latitude != null && it.longitude != null }
            if (first != null) {
                mapView.controller.animateTo(GeoPoint(first.latitude!!, first.longitude!!))
            }
        }
        mapView.invalidate()
    }

    private fun showGatewayDialog() {
        val current = GatewayConfig.resolveGatewayBaseUrl(this)
        val input = android.widget.EditText(this).apply {
            setText(current)
        }
        AlertDialog.Builder(this)
            .setTitle("Gateway Endpoint")
            .setMessage("Set the AetherCore Gateway base URL.")
            .setView(input)
            .setPositiveButton("Save") { _, _ ->
                GatewayConfig.persistGatewayBaseUrl(this, input.text.toString())
                startNodePolling()
                c2Client?.disconnect()
                startC2Link()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    companion object {
        private const val TAG = "AetherCore.ATAK"
        private const val POLL_INTERVAL_MS = 5_000L
        private const val LOCATION_REQUEST_CODE = 3101
    }
}
